import { NextResponse } from "next/server";
import { apiError, createServiceClient } from "@/lib/api";
import { dispatchEventTriggers } from "@/lib/triggers/dispatch-event";
import { verifyWebhookToken } from "@/lib/webhooks/signed-token";

type SheetsConnectionRow = {
  id: string;
  user_id: string;
  metadata: Record<string, unknown> | null;
};

type SheetsWebhookToken = {
  connection_id: string;
  user_id: string;
  spreadsheet_id: string;
  channel_id: string;
};

export async function POST(request: Request) {
  const channelId = request.headers.get("x-goog-channel-id");
  const channelToken = request.headers.get("x-goog-channel-token");
  const resourceId = request.headers.get("x-goog-resource-id");
  const resourceState = request.headers.get("x-goog-resource-state");
  const messageNumber = request.headers.get("x-goog-message-number");
  const resourceUri = request.headers.get("x-goog-resource-uri");

  if (!channelId || !channelToken || !resourceState) {
    return apiError("Missing Google channel headers", 400);
  }

  const tokenSecret = process.env.GOOGLE_WEBHOOK_TOKEN_SECRET ?? process.env.RUNTIME_SECRET;
  if (!tokenSecret) {
    return apiError("Missing webhook token secret", 500);
  }

  const tokenPayload = verifyWebhookToken<SheetsWebhookToken>(channelToken, tokenSecret);
  if (!tokenPayload) return apiError("Invalid channel token", 401);
  if (tokenPayload.channel_id !== channelId) return apiError("Channel id mismatch", 401);

  const db = createServiceClient();
  const { data: rowRaw } = await db
    .from("connections")
    .select("id, user_id, metadata")
    .eq("id", tokenPayload.connection_id)
    .eq("provider", "sheets")
    .eq("is_valid", true)
    .single();

  if (!rowRaw) return apiError("Connection not found", 404);
  const connection = rowRaw as unknown as SheetsConnectionRow;
  if (connection.user_id !== tokenPayload.user_id) return apiError("Connection mismatch", 401);

  const watchState = _resolveWatchState(connection.metadata, tokenPayload.spreadsheet_id);
  if (!watchState) return apiError("Watch state not found", 404);
  if (watchState.channel_id !== channelId) return apiError("Watch channel mismatch", 401);
  if (watchState.resource_id && resourceId && watchState.resource_id !== resourceId) {
    return apiError("Watch resource mismatch", 401);
  }

  // Initial sync handshakes are expected and should be acknowledged quickly.
  if (resourceState === "sync") {
    return NextResponse.json({ ok: true, synced: true });
  }

  await dispatchEventTriggers({
    source: "sheets",
    event: "spreadsheet.changed",
    payload: {
      spreadsheet_id: tokenPayload.spreadsheet_id,
      resource_state: resourceState,
      resource_id: resourceId,
      resource_uri: resourceUri,
      message_number: messageNumber,
      channel_id: channelId,
    },
    connection_id: connection.id,
    user_id: connection.user_id,
  });

  return NextResponse.json({ ok: true, accepted: true });
}

function _resolveWatchState(
  metadata: Record<string, unknown> | null,
  spreadsheetId: string
): { channel_id: string; resource_id?: string } | null {
  if (!metadata || typeof metadata !== "object") return null;
  const watches = metadata.sheets_watches;
  if (!watches || typeof watches !== "object" || Array.isArray(watches)) return null;
  const state = (watches as Record<string, unknown>)[spreadsheetId];
  if (!state || typeof state !== "object" || Array.isArray(state)) return null;

  const channelId = (state as Record<string, unknown>).channel_id;
  const resourceId = (state as Record<string, unknown>).resource_id;
  if (typeof channelId !== "string" || !channelId) return null;
  return {
    channel_id: channelId,
    resource_id: typeof resourceId === "string" ? resourceId : undefined,
  };
}
