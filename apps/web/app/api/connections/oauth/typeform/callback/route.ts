import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/api";
import { vaultStore } from "@/lib/vault";

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
    label = decoded.label ?? "typeform:primary";
  } catch {
    return NextResponse.redirect(`${origin}/connections?error=invalid_state`);
  }

  const tokenRes = await fetch("https://api.typeform.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: process.env.TYPEFORM_CLIENT_ID!,
      client_secret: process.env.TYPEFORM_CLIENT_SECRET!,
      redirect_uri: `${process.env.NEXT_PUBLIC_APP_URL}/api/connections/oauth/typeform/callback`,
      code,
    }),
  });

  if (!tokenRes.ok) return NextResponse.redirect(`${origin}/connections?error=token_exchange_failed`);

  const tokens = await tokenRes.json();

  const meRes = await fetch("https://api.typeform.com/me", {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  const meInfo = meRes.ok ? await meRes.json() : {};

  const serviceClient = createServiceClient();
  let vaultId: string;
  try {
    vaultId = await vaultStore(
      serviceClient,
      JSON.stringify(tokens),
      `oauth:${userId}:typeform:${label}`,
      `Typeform OAuth tokens for user ${userId}`
    );
  } catch {
    return NextResponse.redirect(`${origin}/connections?error=vault_failed`);
  }

  const { error } = await serviceClient.from("connections").insert({
    user_id: userId,
    name: label,
    provider: "typeform",
    auth_type: "oauth",
    vault_secret_id: vaultId,
    scopes: ["responses:read", "forms:read"],
    metadata: { email: meInfo.email ?? null, alias: meInfo.alias ?? null },
    is_valid: true,
    last_validated_at: new Date().toISOString(),
  });

  if (error) return NextResponse.redirect(`${origin}/connections?error=db_insert_failed`);

  return NextResponse.redirect(`${origin}/connections?connected=typeform`);
}
