import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/api";
import { storeOAuthTokens } from "@/lib/oauth-token";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const errorParam = searchParams.get("error");

  if (errorParam) return NextResponse.redirect(`${origin}/connections?error=${errorParam}`);
  if (!code || !state) return NextResponse.redirect(`${origin}/connections?error=missing_params`);

  let userId: string;
  let label: string;
  try {
    const decoded = JSON.parse(Buffer.from(state, "base64url").toString());
    userId = decoded.userId;
    label = decoded.label ?? "slack:primary";
  } catch {
    return NextResponse.redirect(`${origin}/connections?error=invalid_state`);
  }

  const tokenRes = await fetch("https://slack.com/api/oauth.v2.access", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.SLACK_CLIENT_ID!,
      client_secret: process.env.SLACK_CLIENT_SECRET!,
      redirect_uri: `${process.env.NEXT_PUBLIC_APP_URL}/api/connections/oauth/slack/callback`,
    }),
  });

  if (!tokenRes.ok) return NextResponse.redirect(`${origin}/connections?error=token_exchange_failed`);

  const tokens = await tokenRes.json();
  if (!tokens.ok) return NextResponse.redirect(`${origin}/connections?error=${tokens.error ?? "slack_error"}`);

  const teamName: string = tokens.team?.name ?? "";
  const botToken: string = tokens.access_token;

  const serviceClient = createServiceClient();
  let vaultId: string;
  try {
    vaultId = await storeOAuthTokens(
      serviceClient,
      { access_token: botToken, team: tokens.team },
      `oauth:${userId}:slack:${label}`,
      `Slack OAuth tokens for user ${userId}`
    );
  } catch {
    return NextResponse.redirect(`${origin}/connections?error=vault_failed`);
  }

  const { error } = await serviceClient.from("connections").insert({
    user_id: userId,
    name: label,
    provider: "slack",
    auth_type: "oauth",
    vault_secret_id: vaultId,
    scopes: ["channels:read", "chat:write"],
    metadata: { team: teamName },
    is_valid: true,
    last_validated_at: new Date().toISOString(),
  });

  if (error) return NextResponse.redirect(`${origin}/connections?error=db_insert_failed`);

  return NextResponse.redirect(`${origin}/connections?connected=slack`);
}
