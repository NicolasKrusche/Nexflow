import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { apiError, createServiceClient } from "@/lib/api";
import { dispatchEventTriggers } from "@/lib/triggers/dispatch-event";

type AsanaConnectionRow = {
  id: string;
  user_id: string;
  metadata: Record<string, unknown> | null;
};

type AsanaEvent = {
  action: string;
  resource: { gid: string; resource_type: string; name?: string };
  parent: { gid: string; resource_type: string } | null;
  created_at: string;
  user: { gid: string } | null;
};

/**
 * POST /api/webhooks/asana
 *
 * Handles Asana webhook events in two modes:
 *
 * 1. Handshake (first delivery): Asana sends an empty POST with
 *    `X-Hook-Secret` header. We echo it back in the response header.
 *    The secret is also stored per-connection via the `connection_id`
 *    query param so future deliveries can be verified.
 *
 * 2. Event delivery: subsequent POSTs are signed with HMAC-SHA256 of the
 *    raw body using the hook secret from the handshake, delivered in
 *    `X-Hook-Signature`.
 *
 * Required query param: ?connection_id=<uuid>
 * (Asana webhooks are registered per workspace/project, so a connection_id
 *  is always known at registration time.)
 *
 * Events dispatched:
 *   source: "asana"
 *   event: "task.added" | "task.removed" | "task.changed" | "task.completed" |
 *          "story.added" | "project.added" | ...
 *   (format: "<resource_type>.<action>")
 */
export async function POST(request: Request) {
  const rawBody = await request.text();

  // ── Asana handshake ──────────────────────────────────────────────────────────
  const hookSecret = request.headers.get("x-hook-secret");
  if (hookSecret) {
    // Store the hook secret against this connection so future requests can be verified
    const url = new URL(request.url);
    const connectionId = url.searchParams.get("connection_id");
    if (connectionId) {
      const db = createServiceClient();
      // Store in metadata; non-critical if this fails
      await db
        .from("connections")
        .update({ metadata: { asana_hook_secret: hookSecret } } as never)
        .eq("id", connectionId)
        .eq("provider", "asana");
    }
    return new NextResponse(null, {
      status: 200,
      headers: { "X-Hook-Secret": hookSecret },
    });
  }

  // ── Signature verification ───────────────────────────────────────────────────
  const receivedSignature = request.headers.get("x-hook-signature");
  if (!receivedSignature) return apiError("Missing X-Hook-Signature header", 401);

  const url = new URL(request.url);
  const connectionId = url.searchParams.get("connection_id");
  if (!connectionId) return apiError("connection_id query param required", 400);

  const db = createServiceClient();
  const { data: connRaw } = await db
    .from("connections")
    .select("id, user_id, metadata")
    .eq("id", connectionId)
    .eq("provider", "asana")
    .eq("is_valid", true)
    .single();

  if (!connRaw) return apiError("Connection not found", 404);
  const connection = connRaw as unknown as AsanaConnectionRow;

  const storedSecret =
    typeof connection.metadata?.asana_hook_secret === "string"
      ? connection.metadata.asana_hook_secret
      : null;

  if (!storedSecret) {
    return apiError("Hook secret not yet stored for this connection", 409);
  }

  const expectedSignature = createHmac("sha256", storedSecret)
    .update(rawBody)
    .digest("hex");
  const expectedBuf = Buffer.from(expectedSignature);
  const receivedBuf = Buffer.from(receivedSignature);
  if (
    expectedBuf.length !== receivedBuf.length ||
    !timingSafeEqual(expectedBuf, receivedBuf)
  ) {
    return apiError("Invalid Asana hook signature", 401);
  }

  // ── Parse events ─────────────────────────────────────────────────────────────
  let body: { events?: AsanaEvent[] };
  try {
    body = JSON.parse(rawBody);
  } catch {
    return apiError("Invalid JSON body", 400);
  }

  const events = body.events ?? [];
  if (events.length === 0) {
    return NextResponse.json({ ok: true, accepted: true, fired: 0 });
  }

  // Group by derived event name and dispatch each group
  const byEventName = new Map<string, AsanaEvent[]>();
  for (const ev of events) {
    const name = _deriveEventName(ev);
    const group = byEventName.get(name) ?? [];
    group.push(ev);
    byEventName.set(name, group);
  }

  let totalFired = 0;
  await Promise.all(
    [...byEventName.entries()].map(async ([eventName, group]) => {
      const result = await dispatchEventTriggers({
        source: "asana",
        event: eventName,
        payload: {
          events: group,
          // Convenience: first event's resource
          resource_gid: group[0]?.resource?.gid ?? null,
          resource_type: group[0]?.resource?.resource_type ?? null,
          resource_name: group[0]?.resource?.name ?? null,
          parent_gid: group[0]?.parent?.gid ?? null,
          action: group[0]?.action ?? null,
        },
        connection_id: connection.id,
        user_id: connection.user_id,
      });
      totalFired += result.fired;
    })
  );

  return NextResponse.json({
    ok: true,
    accepted: true,
    events: [...byEventName.keys()],
    fired: totalFired,
  });
}

function _deriveEventName(event: AsanaEvent): string {
  const resourceType = event.resource?.resource_type ?? "unknown";
  const action = event.action ?? "changed";

  // Map Asana action names to clean event names
  const actionMap: Record<string, string> = {
    added: "added",
    removed: "removed",
    changed: "changed",
    deleted: "removed",
    undeleted: "added",
  };
  const mappedAction = actionMap[action] ?? action;

  // Special case: task marked complete
  if (
    resourceType === "task" &&
    action === "changed" &&
    event.resource?.name === "completed"
  ) {
    return "task.completed";
  }

  return `${resourceType}.${mappedAction}`;
}
