import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceClient, apiError } from "@/lib/api";
import { vaultDelete, vaultRetrieve, vaultStore } from "@/lib/vault";

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
    .select("name, provider, vault_secret_id")
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

  const testResult = await testConnection(row.provider, tokenJson);
  const nowIso = new Date().toISOString();

  // When Gmail access tokens expire, use refresh_token and persist the new token set.
  let refreshedVaultSecretId: string | null = null;
  if (testResult.refreshedTokenJson) {
    try {
      refreshedVaultSecretId = await vaultStore(
        serviceClient,
        testResult.refreshedTokenJson,
        `oauth:${user.id}:${row.provider}:${row.name}:refresh:${Date.now()}`,
        `${row.provider} OAuth tokens (refreshed) for user ${user.id}`
      );
    } catch {
      return apiError("Failed to persist refreshed token", 500);
    }
  }

  const updatePayload: {
    is_valid: boolean;
    last_validated_at: string;
    vault_secret_id?: string;
  } = {
    is_valid: testResult.isValid,
    last_validated_at: nowIso,
  };

  if (refreshedVaultSecretId) {
    updatePayload.vault_secret_id = refreshedVaultSecretId;
  }

  const { error: updateError } = await supabase
    .from("connections")
    .update(updatePayload)
    .eq("id", params.id);

  if (updateError) {
    if (refreshedVaultSecretId) {
      try {
        await vaultDelete(serviceClient, refreshedVaultSecretId);
      } catch {
        // Continue
      }
    }
    return apiError(updateError.message, 500);
  }

  if (refreshedVaultSecretId) {
    try {
      await vaultDelete(serviceClient, row.vault_secret_id);
    } catch {
      // Continue
    }
  }

  return NextResponse.json({ is_valid: testResult.isValid });
}

type TokenPayload = {
  access_token?: string;
  refresh_token?: string;
  [key: string]: unknown;
};

type TestConnectionResult = {
  isValid: boolean;
  refreshedTokenJson?: string;
};

async function testConnection(provider: string, tokenJson: string): Promise<TestConnectionResult> {
  try {
    const tokens = JSON.parse(tokenJson) as TokenPayload;
    if (provider === "gmail") {
      return testGmailConnection(tokens);
    }
    if (provider === "notion") {
      const res = await fetch("https://api.notion.com/v1/users/me", {
        headers: {
          Authorization: `Bearer ${tokens.access_token}`,
          "Notion-Version": "2022-06-28",
        },
      });
      return { isValid: res.ok };
    }
    if (provider === "slack") {
      const res = await fetch("https://slack.com/api/auth.test", {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      const data = await res.json();
      return { isValid: data.ok === true };
    }
    return { isValid: true };
  } catch {
    return { isValid: false };
  }
}

async function testGmailConnection(tokens: TokenPayload): Promise<TestConnectionResult> {
  if (!tokens.access_token) {
    return { isValid: false };
  }

  const accessCheck = await gmailUserInfo(tokens.access_token);
  if (accessCheck.ok) {
    return { isValid: true };
  }

  // Only attempt refresh when token appears expired/invalid.
  if (accessCheck.status !== 401 || !tokens.refresh_token) {
    return { isValid: false };
  }

  const refreshed = await refreshGmailAccessToken(tokens.refresh_token);
  if (!refreshed?.access_token) {
    return { isValid: false };
  }

  const mergedTokens: TokenPayload = {
    ...tokens,
    ...refreshed,
    refresh_token: refreshed.refresh_token ?? tokens.refresh_token,
  };

  const refreshCheck = await gmailUserInfo(mergedTokens.access_token as string);
  if (!refreshCheck.ok) {
    return { isValid: false };
  }

  return {
    isValid: true,
    refreshedTokenJson: JSON.stringify(mergedTokens),
  };
}

async function gmailUserInfo(accessToken: string): Promise<Response> {
  return fetch("https://www.googleapis.com/oauth2/v1/userinfo?alt=json", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

async function refreshGmailAccessToken(refreshToken: string): Promise<TokenPayload | null> {
  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
    });

    if (!res.ok) return null;
    return (await res.json()) as TokenPayload;
  } catch {
    return null;
  }
}
