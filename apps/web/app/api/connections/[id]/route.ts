import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceClient, apiError } from "@/lib/api";
import { vaultDelete } from "@/lib/vault";
import { getValidOAuthToken } from "@/lib/oauth-token";

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

// POST /api/connections/:id — live ping (test connection validity)
export async function POST(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiError("Unauthorized", 401);

  const { data: row, error: fetchError } = await supabase
    .from("connections")
    .select("provider")
    .eq("id", params.id)
    .eq("user_id", user.id)
    .single();

  if (fetchError || !row) return apiError("Connection not found", 404);

  const serviceClient = createServiceClient();
  let accessToken: string;
  try {
    // getValidOAuthToken handles token refresh + vault rotation transparently
    accessToken = await getValidOAuthToken(serviceClient, params.id);
  } catch {
    await supabase
      .from("connections")
      .update({ is_valid: false, last_validated_at: new Date().toISOString() })
      .eq("id", params.id);
    return NextResponse.json({ is_valid: false });
  }

  const isValid = await pingProvider(row.provider, accessToken);

  await supabase
    .from("connections")
    .update({ is_valid: isValid, last_validated_at: new Date().toISOString() })
    .eq("id", params.id);

  return NextResponse.json({ is_valid: isValid });
}

async function pingProvider(provider: string, accessToken: string): Promise<boolean> {
  try {
    switch (provider) {
      case "gmail":
      case "sheets":
      case "calendar":
      case "docs":
      case "drive":
        return (await fetch("https://www.googleapis.com/oauth2/v1/userinfo?alt=json", {
          headers: { Authorization: `Bearer ${accessToken}` },
        })).ok;

      case "notion":
        return (await fetch("https://api.notion.com/v1/users/me", {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Notion-Version": "2022-06-28",
          },
        })).ok;

      case "slack": {
        const res = await fetch("https://slack.com/api/auth.test", {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const data = await res.json() as { ok: boolean };
        return data.ok === true;
      }

      case "github":
        return (await fetch("https://api.github.com/user", {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "X-GitHub-Api-Version": "2022-11-28",
          },
        })).ok;

      case "airtable":
        return (await fetch("https://api.airtable.com/v0/meta/whoami", {
          headers: { Authorization: `Bearer ${accessToken}` },
        })).ok;

      case "hubspot":
        return (await fetch(`https://api.hubapi.com/oauth/v1/access-tokens/${accessToken}`)).ok;

      case "outlook":
        return (await fetch("https://graph.microsoft.com/v1.0/me", {
          headers: { Authorization: `Bearer ${accessToken}` },
        })).ok;

      case "asana":
        return (await fetch("https://app.asana.com/api/1.0/users/me", {
          headers: { Authorization: `Bearer ${accessToken}` },
        })).ok;

      case "typeform":
        return (await fetch("https://api.typeform.com/me", {
          headers: { Authorization: `Bearer ${accessToken}` },
        })).ok;

      default:
        return true;
    }
  } catch {
    return false;
  }
}
