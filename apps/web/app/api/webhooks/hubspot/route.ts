import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { apiError, createServiceClient } from "@/lib/api";
import { dispatchEventTriggers } from "@/lib/triggers/dispatch-event";

type HubSpotConnectionRow = {
  id: string;
  user_id: string;
  metadata: Record<string, unknown> | null;
};

type HubSpotEventItem = {
  subscriptionType: string;
  objectId: number;
  propertyName?: string;
  propertyValue?: string;
  changeSource?: string;
  eventId: number;
  subscriptionId: number;
  portalId: number;
  appId: number;
  occurredAt: number;
  attemptNumber: number;
};

/**
 * POST /api/webhooks/hubspot
 *
 * Receives HubSpot CRM webhook notifications (v1 signature).
 * HubSpot signs with SHA256 of (client_secret + raw_body), delivered in
 * the `X-HubSpot-Signature` header.
 *
 * Required env: HUBSPOT_CLIENT_SECRET
 * Optional query param: ?connection_id=<uuid> to scope to one portal.
 *
 * Events dispatched (one per unique subscriptionType in the batch):
 *   source: "hubspot"
 *   event: "contact.creation" | "contact.deletion" | "contact.propertyChange" |
 *          "deal.creation" | "deal.deletion" | "deal.propertyChange" | ...
 */
export async function POST(request: Request) {
  const clientSecret = process.env.HUBSPOT_CLIENT_SECRET;
  if (!clientSecret) {
    return apiError("Missing HUBSPOT_CLIENT_SECRET", 500);
  }

  const rawBody = await request.text();
  const receivedSignature = request.headers.get("x-hubspot-signature");
  if (!receivedSignature) return apiError("Missing X-HubSpot-Signature header", 401);

  const expectedSignature = createHmac("sha256", clientSecret)
    .update(clientSecret + rawBody)
    .digest("hex");
  const expectedBuf = Buffer.from(expectedSignature);
  const receivedBuf = Buffer.from(receivedSignature);
  if (
    expectedBuf.length !== receivedBuf.length ||
    !timingSafeEqual(expectedBuf, receivedBuf)
  ) {
    return apiError("Invalid HubSpot signature", 401);
  }

  let events: HubSpotEventItem[];
  try {
    events = JSON.parse(rawBody) as HubSpotEventItem[];
    if (!Array.isArray(events)) throw new Error("Expected array");
  } catch {
    return apiError("Invalid JSON body — expected array of HubSpot events", 400);
  }

  if (events.length === 0) {
    return NextResponse.json({ ok: true, accepted: true, matched_connections: 0 });
  }

  const portalId = events[0]?.portalId ?? null;
  const url = new URL(request.url);
  const explicitConnectionId = url.searchParams.get("connection_id");

  const connections = await _resolveConnections(portalId, explicitConnectionId);
  if (connections.length === 0) {
    return NextResponse.json({ ok: true, accepted: true, matched_connections: 0 });
  }

  // Group events by subscriptionType and dispatch each type once per connection
  const byType = new Map<string, HubSpotEventItem[]>();
  for (const ev of events) {
    const type = ev.subscriptionType ?? "unknown";
    const group = byType.get(type) ?? [];
    group.push(ev);
    byType.set(type, group);
  }

  let totalFired = 0;
  await Promise.all(
    [...byType.entries()].flatMap(([eventType, group]) =>
      connections.map(async (connection) => {
        const result = await dispatchEventTriggers({
          source: "hubspot",
          event: eventType,
          payload: {
            portal_id: portalId,
            subscription_type: eventType,
            events: group,
            // Convenience fields for single-event subscriptions
            object_id: group[0]?.objectId ?? null,
            property_name: group[0]?.propertyName ?? null,
            property_value: group[0]?.propertyValue ?? null,
          },
          connection_id: connection.id,
          user_id: connection.user_id,
        });
        totalFired += result.fired;
      })
    )
  );

  return NextResponse.json({
    ok: true,
    accepted: true,
    matched_connections: connections.length,
    events: [...byType.keys()],
    fired: totalFired,
  });
}

async function _resolveConnections(
  portalId: number | null,
  explicitConnectionId: string | null
): Promise<HubSpotConnectionRow[]> {
  const db = createServiceClient();

  if (explicitConnectionId) {
    const { data } = await db
      .from("connections")
      .select("id, user_id, metadata")
      .eq("id", explicitConnectionId)
      .eq("provider", "hubspot")
      .eq("is_valid", true)
      .single();
    if (!data) return [];
    return [data as unknown as HubSpotConnectionRow];
  }

  const { data: rows } = await db
    .from("connections")
    .select("id, user_id, metadata")
    .eq("provider", "hubspot")
    .eq("is_valid", true);

  const all = (rows ?? []) as unknown as HubSpotConnectionRow[];

  if (portalId === null) return all;

  const scoped = all.filter(
    (row) => row.metadata?.portal_id === portalId || row.metadata?.hub_id === portalId
  );
  return scoped.length > 0 ? scoped : all;
}
