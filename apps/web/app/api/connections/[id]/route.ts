import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceClient, apiError } from "@/lib/api";
import { vaultDelete, vaultRetrieve } from "@/lib/vault";

// DELETE /api/connections/:id
export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiError("Unauthorized", 401);

  const { data: row, error: fetchError } = await supabase
    .from("connections")
    .select("vault_secret_id")
    .eq("id", params.id)
    .eq("user_id", user.id)
    .single();

  if (fetchError || !row) return apiError("Connection not found", 404);

  try {
    const serviceClient = createServiceClient();
    await vaultDelete(serviceClient, row.vault_secret_id);
  } catch {
    // Continue
  }

  const { error } = await supabase.from("connections").delete().eq("id", params.id);
  if (error) return apiError(error.message, 500);

  return new NextResponse(null, { status: 204 });
}

// POST /api/connections/:id/test — live ping
export async function POST(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiError("Unauthorized", 401);

  const { data: row, error: fetchError } = await supabase
    .from("connections")
    .select("provider, vault_secret_id, scopes")
    .eq("id", params.id)
    .eq("user_id", user.id)
    .single();

  if (fetchError || !row) return apiError("Connection not found", 404);

  const serviceClient = createServiceClient();
  let tokenJson: string;
  try {
    tokenJson = await vaultRetrieve(serviceClient, row.vault_secret_id);
  } catch {
    return apiError("Failed to retrieve token", 500);
  }

  const isValid = await testConnection(row.provider, tokenJson);

  await supabase
    .from("connections")
    .update({ is_valid: isValid, last_validated_at: new Date().toISOString() })
    .eq("id", params.id);

  return NextResponse.json({ is_valid: isValid });
}

async function testConnection(provider: string, tokenJson: string): Promise<boolean> {
  try {
    const tokens = JSON.parse(tokenJson);
    if (provider === "gmail") {
      const res = await fetch("https://www.googleapis.com/oauth2/v1/userinfo?alt=json", {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      return res.ok;
    }
    if (provider === "notion") {
      const res = await fetch("https://api.notion.com/v1/users/me", {
        headers: {
          Authorization: `Bearer ${tokens.access_token}`,
          "Notion-Version": "2022-06-28",
        },
      });
      return res.ok;
    }
    if (provider === "slack") {
      const res = await fetch("https://slack.com/api/auth.test", {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      const data = await res.json();
      return data.ok === true;
    }
    return true;
  } catch {
    return false;
  }
}
