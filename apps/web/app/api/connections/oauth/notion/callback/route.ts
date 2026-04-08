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
    label = decoded.label ?? "notion:primary";
  } catch {
    return NextResponse.redirect(`${origin}/connections?error=invalid_state`);
  }

  // Notion requires Basic auth with client_id:client_secret
  const credentials = Buffer.from(
    `${process.env.NOTION_CLIENT_ID}:${process.env.NOTION_CLIENT_SECRET}`
  ).toString("base64");

  const tokenRes = await fetch("https://api.notion.com/v1/oauth/token", {
    method: "POST",
    headers: {
      "Authorization": `Basic ${credentials}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      grant_type: "authorization_code",
      code,
      redirect_uri: `${process.env.NEXT_PUBLIC_APP_URL}/api/connections/oauth/notion/callback`,
    }),
  });

  if (!tokenRes.ok) return NextResponse.redirect(`${origin}/connections?error=token_exchange_failed`);

  const tokens = await tokenRes.json();
  const workspaceName: string = tokens.workspace_name ?? "";

  const serviceClient = createServiceClient();
  let vaultId: string;
  try {
    vaultId = await vaultStore(
      serviceClient,
      JSON.stringify(tokens),
      `oauth:${userId}:notion:${label}`,
      `Notion OAuth tokens for user ${userId}`
    );
  } catch {
    return NextResponse.redirect(`${origin}/connections?error=vault_failed`);
  }

  const { error } = await serviceClient.from("connections").insert({
    user_id: userId,
    name: label,
    provider: "notion",
    auth_type: "oauth",
    vault_secret_id: vaultId,
    scopes: ["read_content", "update_content", "insert_content"],
    metadata: { workspace: workspaceName },
    is_valid: true,
    last_validated_at: new Date().toISOString(),
  });

  if (error) return NextResponse.redirect(`${origin}/connections?error=db_insert_failed`);

  return NextResponse.redirect(`${origin}/connections?connected=notion`);
}
