import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { apiError, createServiceClient } from "@/lib/api";
import { dispatchEventTriggers } from "@/lib/triggers/dispatch-event";

type GitHubConnectionRow = {
  id: string;
  user_id: string;
  metadata: Record<string, unknown> | null;
};

export async function POST(request: Request) {
  const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return apiError("Missing GITHUB_WEBHOOK_SECRET", 500);
  }

  const rawBody = await request.text();
  const receivedSignature = request.headers.get("x-hub-signature-256");
  if (!receivedSignature) return apiError("Missing GitHub signature", 401);

  const expectedSignature = `sha256=${createHmac("sha256", webhookSecret).update(rawBody).digest("hex")}`;
  const expectedBuf = Buffer.from(expectedSignature);
  const receivedBuf = Buffer.from(receivedSignature);
  if (expectedBuf.length !== receivedBuf.length || !timingSafeEqual(expectedBuf, receivedBuf)) {
    return apiError("Invalid GitHub signature", 401);
  }

  const githubEvent = request.headers.get("x-github-event");
  if (!githubEvent) return apiError("Missing x-github-event header", 400);

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return apiError("Invalid JSON body", 400);
  }

  if (githubEvent === "ping") {
    return NextResponse.json({ ok: true, ping: true });
  }

  const url = new URL(request.url);
  const explicitConnectionId = url.searchParams.get("connection_id");
  const connectionIds = await _resolveMatchingConnections(body, explicitConnectionId);
  if (connectionIds.length === 0) {
    return NextResponse.json({ ok: true, accepted: true, matched_connections: 0 });
  }

  const action = typeof body.action === "string" ? body.action : null;
  const eventName = action ? `${githubEvent}.${action}` : githubEvent;
  const deliveryId = request.headers.get("x-github-delivery");

  await Promise.all(
    connectionIds.map((connection) =>
      dispatchEventTriggers({
        source: "github",
        event: eventName,
        payload: {
          delivery_id: deliveryId,
          event: githubEvent,
          action,
          repository: body.repository,
          organization: body.organization,
          sender: body.sender,
          installation: body.installation,
          payload: body,
        },
        connection_id: connection.id,
        user_id: connection.user_id,
      })
    )
  );

  return NextResponse.json({
    ok: true,
    accepted: true,
    matched_connections: connectionIds.length,
    event: eventName,
  });
}

async function _resolveMatchingConnections(
  body: Record<string, unknown>,
  explicitConnectionId: string | null
): Promise<GitHubConnectionRow[]> {
  const db = createServiceClient();

  if (explicitConnectionId) {
    const { data: rowRaw } = await db
      .from("connections")
      .select("id, user_id, metadata")
      .eq("id", explicitConnectionId)
      .eq("provider", "github")
      .eq("is_valid", true)
      .single();
    if (!rowRaw) return [];
    return [rowRaw as unknown as GitHubConnectionRow];
  }

  const { data: rowsRaw } = await db
    .from("connections")
    .select("id, user_id, metadata")
    .eq("provider", "github")
    .eq("is_valid", true);
  const rows = (rowsRaw ?? []) as unknown as GitHubConnectionRow[];

  const repository = (body.repository ?? {}) as Record<string, unknown>;
  const repoOwner = (repository.owner ?? {}) as Record<string, unknown>;
  const sender = (body.sender ?? {}) as Record<string, unknown>;
  const organization = (body.organization ?? {}) as Record<string, unknown>;

  const candidates = new Set<string>();
  for (const value of [repoOwner.login, sender.login, organization.login]) {
    if (typeof value === "string" && value) candidates.add(value.toLowerCase());
  }
  if (candidates.size === 0) return [];

  return rows.filter((row) => {
    const login = row.metadata?.login;
    return typeof login === "string" && candidates.has(login.toLowerCase());
  });
}
