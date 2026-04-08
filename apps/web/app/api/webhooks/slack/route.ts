import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { apiError, createServiceClient } from "@/lib/api";
import { dispatchEventTriggers } from "@/lib/triggers/dispatch-event";

type SlackConnectionRow = {
  id: string;
  user_id: string;
  metadata: Record<string, unknown> | null;
};

export async function POST(request: Request) {
  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  if (!signingSecret) {
    return apiError("Missing SLACK_SIGNING_SECRET", 500);
  }

  const rawBody = await request.text();
  const timestamp = request.headers.get("x-slack-request-timestamp");
  const receivedSignature = request.headers.get("x-slack-signature");
  if (!timestamp || !receivedSignature) {
    return apiError("Missing Slack signature headers", 401);
  }

  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Math.floor(Date.now() / 1000) - ts) > 300) {
    return apiError("Stale Slack request", 401);
  }

  const base = `v0:${timestamp}:${rawBody}`;
  const expectedSignature = `v0=${createHmac("sha256", signingSecret).update(base).digest("hex")}`;
  const expectedBuf = Buffer.from(expectedSignature);
  const receivedBuf = Buffer.from(receivedSignature);
  if (expectedBuf.length !== receivedBuf.length || !timingSafeEqual(expectedBuf, receivedBuf)) {
    return apiError("Invalid Slack signature", 401);
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return apiError("Invalid JSON body", 400);
  }

  if (body.type === "url_verification") {
    return NextResponse.json({ challenge: body.challenge ?? "" });
  }

  if (body.type !== "event_callback") {
    return NextResponse.json({ ok: true, ignored: true });
  }

  const eventObj = (body.event ?? {}) as Record<string, unknown>;
  const teamId =
    (typeof body.team_id === "string" ? body.team_id : null) ??
    (typeof body.team === "string" ? body.team : null);
  if (!teamId) {
    return apiError("Missing team id", 400);
  }

  const db = createServiceClient();
  const { data: rowsRaw, error } = await db
    .from("connections")
    .select("id, user_id, metadata")
    .eq("provider", "slack")
    .eq("is_valid", true);
  if (error) return apiError(error.message, 500);

  const rows = (rowsRaw ?? []) as unknown as SlackConnectionRow[];
  const connections = rows.filter((row) => row.metadata?.team_id === teamId);
  if (connections.length === 0) {
    return NextResponse.json({ ok: true, accepted: true, matched_connections: 0 });
  }

  const eventName = _deriveSlackEventName(eventObj);
  await Promise.all(
    connections.map((connection) =>
      dispatchEventTriggers({
        source: "slack",
        event: eventName,
        payload: {
          team_id: teamId,
          event_id: body.event_id,
          event_time: body.event_time,
          api_app_id: body.api_app_id,
          authed_users: body.authed_users,
          event: eventObj,
        },
        connection_id: connection.id,
        user_id: connection.user_id,
      })
    )
  );

  return NextResponse.json({
    ok: true,
    accepted: true,
    matched_connections: connections.length,
    event: eventName,
  });
}

function _deriveSlackEventName(eventObj: Record<string, unknown>): string {
  const type = typeof eventObj.type === "string" ? eventObj.type : "unknown";
  const subtype = typeof eventObj.subtype === "string" ? eventObj.subtype : null;
  return subtype ? `${type}.${subtype}` : type;
}
