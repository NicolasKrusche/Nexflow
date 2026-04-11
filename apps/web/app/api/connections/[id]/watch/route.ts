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

  if (connection.provider === "slack") {
    return _setupSlackWatch(connection, db);
  }

  if (connection.provider === "github") {
    return _setupGitHubWatch(connection, accessToken, body, db);
  }

  return apiError("Watch setup is not supported for this provider", 400);
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
    cache: "no-store",
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
      cache: "no-store",
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

// Slack Event API subscriptions are configured in the Slack app settings — there is no
// programmatic API to register event subscriptions with a user OAuth token. This endpoint
// returns the webhook URL that must be pasted into the Slack app's Event Subscriptions page,
// and records the timestamp so the UI can show watch status.
async function _setupSlackWatch(
  connection: ConnectionRow,
  db: ReturnType<typeof createServiceClient>
) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const webhookUrl = `${appUrl}/api/webhooks/slack`;

  const metadata = connection.metadata ?? {};
  const nextMetadata: Record<string, unknown> = {
    ...metadata,
    slack_watch: {
      webhook_url: webhookUrl,
      configured_at: new Date().toISOString(),
    },
  };

  await db
    .from("connections")
    .update({ metadata: nextMetadata } as never)
    .eq("id", connection.id);

  return NextResponse.json({
    provider: "slack",
    webhook_url: webhookUrl,
    note: "Paste this URL into your Slack app's Event Subscriptions page (Features → Event Subscriptions → Request URL). Then subscribe to the workspace events you need (e.g. message.channels, app_mention).",
    watch: nextMetadata.slack_watch,
  });
}

// GitHub webhooks can be created programmatically per-repo. If the caller supplies a
// `repo` (owner/repo format) in the request body, we create a webhook via the GitHub API.
// Otherwise we return the webhook URL as a reference for manual setup.
async function _setupGitHubWatch(
  connection: ConnectionRow,
  accessToken: string,
  body: Record<string, unknown>,
  db: ReturnType<typeof createServiceClient>
) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const webhookUrl = `${appUrl}/api/webhooks/github`;
  const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET ?? "";

  const repo = typeof body.repo === "string" ? body.repo.trim() : "";
  const events =
    Array.isArray(body.events) && body.events.every((e) => typeof e === "string")
      ? (body.events as string[])
      : ["push", "pull_request", "issues"];

  const metadata = connection.metadata ?? {};
  const githubWatches =
    metadata.github_watches && typeof metadata.github_watches === "object"
      ? { ...(metadata.github_watches as Record<string, unknown>) }
      : {};

  if (!repo) {
    // No repo provided — return informational response for manual setup
    const nextMetadata: Record<string, unknown> = {
      ...metadata,
      github_watches: githubWatches,
    };
    await db
      .from("connections")
      .update({ metadata: nextMetadata } as never)
      .eq("id", connection.id);

    return NextResponse.json({
      provider: "github",
      webhook_url: webhookUrl,
      note: "Pass `repo` (owner/repo) in the request body to automatically create a webhook, or add this URL manually in your GitHub repo settings under Webhooks.",
    });
  }

  // Create the webhook on the specified repo
  const [owner, repoName] = repo.split("/");
  if (!owner || !repoName) {
    return apiError("repo must be in owner/repo format", 400);
  }

  const hookBody: Record<string, unknown> = {
    name: "web",
    active: true,
    events,
    config: {
      url: webhookUrl,
      content_type: "json",
      ...(webhookSecret ? { secret: webhookSecret } : {}),
    },
  };

  const ghRes = await fetch(`https://api.github.com/repos/${owner}/${repoName}/hooks`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify(hookBody),
    cache: "no-store",
  });

  if (!ghRes.ok) {
    const text = await ghRes.text();
    return apiError(`GitHub webhook creation failed (${ghRes.status}): ${text.slice(0, 250)}`, 502);
  }

  const hookData = (await ghRes.json()) as { id?: number; created_at?: string };

  githubWatches[repo] = {
    hook_id: hookData.id ?? null,
    events,
    webhook_url: webhookUrl,
    created_at: hookData.created_at ?? new Date().toISOString(),
  };

  const nextMetadata: Record<string, unknown> = {
    ...metadata,
    github_watches: githubWatches,
  };

  await db
    .from("connections")
    .update({ metadata: nextMetadata } as never)
    .eq("id", connection.id);

  return NextResponse.json({
    provider: "github",
    repo,
    watch: githubWatches[repo],
    webhook_url: webhookUrl,
  });
}
