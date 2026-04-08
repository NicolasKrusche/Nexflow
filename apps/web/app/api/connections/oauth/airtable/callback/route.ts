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
  let codeVerifier: string;
  try {
    const decoded = JSON.parse(Buffer.from(state, "base64url").toString());
    userId = decoded.userId;
    label = decoded.label ?? "airtable:primary";
    codeVerifier = decoded.codeVerifier;
  } catch {
    return NextResponse.redirect(`${origin}/connections?error=invalid_state`);
  }

  const credentials = Buffer.from(
    `${process.env.AIRTABLE_CLIENT_ID}:${process.env.AIRTABLE_CLIENT_SECRET}`
  ).toString("base64");

  const tokenRes = await fetch("https://airtable.com/oauth2/v1/token", {
    method: "POST",
    headers: {
      "Authorization": `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: `${process.env.NEXT_PUBLIC_APP_URL}/api/connections/oauth/airtable/callback`,
      code_verifier: codeVerifier,
    }),
  });

  if (!tokenRes.ok) return NextResponse.redirect(`${origin}/connections?error=token_exchange_failed`);

  const tokens = await tokenRes.json();

  const serviceClient = createServiceClient();
  let vaultId: string;
  try {
    vaultId = await vaultStore(
      serviceClient,
      JSON.stringify(tokens),
      `oauth:${userId}:airtable:${label}`,
      `Airtable OAuth tokens for user ${userId}`
    );
  } catch {
    return NextResponse.redirect(`${origin}/connections?error=vault_failed`);
  }

  const { error } = await serviceClient.from("connections").insert({
    user_id: userId,
    name: label,
    provider: "airtable",
    auth_type: "oauth",
    vault_secret_id: vaultId,
    scopes: ["data.records:read", "data.records:write", "schema.bases:read"],
    metadata: {},
    is_valid: true,
    last_validated_at: new Date().toISOString(),
  });

  if (error) return NextResponse.redirect(`${origin}/connections?error=db_insert_failed`);

  return NextResponse.redirect(`${origin}/connections?connected=airtable`);
}
