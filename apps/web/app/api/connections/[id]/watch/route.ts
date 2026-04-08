import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { apiError, createServiceClient } from "@/lib/api";
import { createServerClient } from "@/lib/supabase/server";
import { getValidOAuthToken } from "@/lib/oauth-token";
import { signWebhookToken } from "@/lib/webhooks/signed-token";

type ConnectionRow = {
  id: string;
  user_id: string;
  provider: string;
  metadata: Record<string, unknown> | null;
};

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return apiError("Unauthorized", 401);

  const { data: rowRaw, error } = await supabase
    .from("connections")
    .select("id, user_id, provider, metadata")
    .eq("id", params.id)
    .eq("user_id", user.id)
    .single();

  if (error || !rowRaw) return apiError("Connection not found", 404);
  const connection = rowRaw as unknown as ConnectionRow;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const db = createServiceClient();

  let accessToken: string;
  try {
    accessToken = await getValidOAuthToken(db, connection.id);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to retrieve OAuth token";
    return apiError(message, 500);
  }

  if (connection.provider === "gmail") {
    return _setupGmailWatch(connection, accessToken, body, db);
  }

  if (connection.provider === "sheets") {
    return _setupSheetsWatch(connection, accessToken, body, db);
  }

  return apiError("Watch setup is supported only for gmail and sheets connections", 400);
}

async function _setupGmailWatch(
  connection: ConnectionRow,
  accessToken: string,
  body: Record<string, unknown>,
  db: ReturnType<typeof createServiceClient>
) {
  const topicName =
    (typeof body.topic_name === "string" && body.topic_name) ||
    process.env.GMAIL_WATCH_TOPIC ||
    process.env.GOOGLE_GMAIL_WATCH_TOPIC;
  if (!topicName) {
    return apiError(
      "Missing Gmail watch topic. Set GMAIL_WATCH_TOPIC or pass topic_name in request body.",
      400
    );
  }

  const labelIds =
    Array.isArray(body.label_ids) && body.label_ids.every((v) => typeof v === "string")
      ? (body.label_ids as string[])
      : undefined;
  const labelFilterAction =
    typeof body.label_filter_action === "string" ? body.label_filter_action : undefined;

  const watchReqBody: Record<string, unknown> = { topicName };
  if (labelIds && labelIds.length > 0) watchReqBody.labelIds = labelIds;
  if (labelFilterAction) watchReqBody.labelFilterAction = labelFilterAction;

  const watchRes = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/watch", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(watchReqBody),
  });

  if (!watchRes.ok) {
    const text = await watchRes.text();
    return apiError(`Gmail watch setup failed (${watchRes.status}): ${text.slice(0, 250)}`, 502);
  }

  const watchData = (await watchRes.json()) as {
    historyId?: string;
    expiration?: string;
  };

  const metadata = connection.metadata ?? {};
  const nextMetadata: Record<string, unknown> = {
    ...metadata,
    gmail_watch: {
      topic_name: topicName,
      history_id: watchData.historyId ?? null,
      expiration:
        watchData.expiration && /^\d+$/.test(watchData.expiration)
          ? new Date(Number(watchData.expiration)).toISOString()
          : watchData.expiration ?? null,
      updated_at: new Date().toISOString(),
    },
  };

  await db
    .from("connections")
    .update({ metadata: nextMetadata } as never)
    .eq("id", connection.id);

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return NextResponse.json({
    provider: "gmail",
    watch: nextMetadata.gmail_watch,
    webhook_url: `${appUrl}/api/webhooks/gmail`,
  });
}

async function _setupSheetsWatch(
  connection: ConnectionRow,
  accessToken: string,
  body: Record<string, unknown>,
  db: ReturnType<typeof createServiceClient>
) {
  const spreadsheetId = typeof body.spreadsheet_id === "string" ? body.spreadsheet_id : "";
  if (!spreadsheetId) {
    return apiError("sheets watch requires spreadsheet_id", 400);
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const tokenSecret = process.env.GOOGLE_WEBHOOK_TOKEN_SECRET ?? process.env.RUNTIME_SECRET;
  if (!tokenSecret) {
    return apiError("Missing GOOGLE_WEBHOOK_TOKEN_SECRET (or RUNTIME_SECRET)", 500);
  }

  const channelId = randomUUID();
  const watchToken = signWebhookToken(
    {
      connection_id: connection.id,
      user_id: connection.user_id,
      spreadsheet_id: spreadsheetId,
      channel_id: channelId,
      created_at: new Date().toISOString(),
    },
    tokenSecret
  );

  const watchRes = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
      spreadsheetId
    )}/watch?supportsAllDrives=true`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        id: channelId,
        type: "web_hook",
        address: `${appUrl}/api/webhooks/sheets`,
        token: watchToken,
      }),
    }
  );

  if (!watchRes.ok) {
    const text = await watchRes.text();
    return apiError(`Sheets watch setup failed (${watchRes.status}): ${text.slice(0, 250)}`, 502);
  }

  const watchData = (await watchRes.json()) as {
    id?: string;
    resourceId?: string;
    expiration?: string;
  };

  const metadata = connection.metadata ?? {};
  const sheetsWatches =
    metadata.sheets_watches && typeof metadata.sheets_watches === "object"
      ? { ...(metadata.sheets_watches as Record<string, unknown>) }
      : {};

  sheetsWatches[spreadsheetId] = {
    channel_id: watchData.id ?? channelId,
    resource_id: watchData.resourceId ?? null,
    expiration:
      watchData.expiration && /^\d+$/.test(watchData.expiration)
        ? new Date(Number(watchData.expiration)).toISOString()
        : watchData.expiration ?? null,
    updated_at: new Date().toISOString(),
  };

  const nextMetadata: Record<string, unknown> = {
    ...metadata,
    sheets_watches: sheetsWatches,
  };

  await db
    .from("connections")
    .update({ metadata: nextMetadata } as never)
    .eq("id", connection.id);

  return NextResponse.json({
    provider: "sheets",
    spreadsheet_id: spreadsheetId,
    watch: sheetsWatches[spreadsheetId],
    webhook_url: `${appUrl}/api/webhooks/sheets`,
  });
}
