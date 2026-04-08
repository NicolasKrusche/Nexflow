import { NextResponse } from "next/server";
import { createServiceClient, apiError } from "@/lib/api";
import { storeOAuthTokens } from "@/lib/oauth-token";

// GET /api/connections/oauth/gmail/callback
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const errorParam = searchParams.get("error");

  if (errorParam) {
    return NextResponse.redirect(`${origin}/connections?error=${errorParam}`);
  }

  if (!code || !state) {
    return NextResponse.redirect(`${origin}/connections?error=missing_params`);
  }

  let userId: string;
  let label: string;
  try {
    const decoded = JSON.parse(Buffer.from(state, "base64url").toString());
    userId = decoded.userId;
    label = decoded.label ?? "gmail:primary";
  } catch {
    return NextResponse.redirect(`${origin}/connections?error=invalid_state`);
  }

  // Exchange code for tokens
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: `${process.env.NEXT_PUBLIC_APP_URL}/api/connections/oauth/gmail/callback`,
      grant_type: "authorization_code",
    }),
  });

  if (!tokenRes.ok) {
    return NextResponse.redirect(`${origin}/connections?error=token_exchange_failed`);
  }

  const tokens = await tokenRes.json();

  // Get user's email for metadata
  const userInfoRes = await fetch("https://www.googleapis.com/oauth2/v1/userinfo?alt=json", {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  const userInfo = userInfoRes.ok ? await userInfoRes.json() : {};

  // Store tokens in Vault
  const serviceClient = createServiceClient();
  let vaultId: string;
  try {
    vaultId = await storeOAuthTokens(
      serviceClient,
      tokens,
      `oauth:${userId}:gmail:${label}`,
      `Gmail OAuth tokens for user ${userId}`
    );
  } catch {
    return NextResponse.redirect(`${origin}/connections?error=vault_failed`);
  }

  // Create connections row
  const { error } = await serviceClient.from("connections").insert({
    user_id: userId,
    name: label,
    provider: "gmail",
    auth_type: "oauth",
    vault_secret_id: vaultId,
    scopes: ["gmail.readonly", "gmail.send"],
    metadata: { email: userInfo.email ?? null },
    is_valid: true,
    last_validated_at: new Date().toISOString(),
  });

  if (error) {
    return NextResponse.redirect(`${origin}/connections?error=db_insert_failed`);
  }

  return NextResponse.redirect(`${origin}/connections?connected=gmail`);
}
