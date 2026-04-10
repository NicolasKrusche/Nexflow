/**
 * OAuth token management — server-side only.
 * Handles token refresh for providers with expiring access tokens.
 * Tokens are NEVER sent to the frontend.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@flowos/db";
import { vaultStore, vaultRetrieve, vaultDelete } from "@/lib/vault";

type Client = SupabaseClient<Database>;

// Seconds before expiry at which we proactively refresh
const REFRESH_THRESHOLD_SECONDS = 300; // 5 minutes

interface StoredTokens {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  expires_at?: number; // unix ms — added by storeOAuthTokens()
  token_type?: string;
  scope?: string;
  [key: string]: unknown;
}

// Provider refresh config: endpoint + how to pass client credentials
const PROVIDER_REFRESH: Record<string, {
  endpoint: string;
  auth: "form" | "basic"; // "form" = client_id/secret in body; "basic" = Authorization header
  clientIdEnv: string;
  clientSecretEnv: string;
}> = {
  gmail:    { endpoint: "https://oauth2.googleapis.com/token",                           auth: "form", clientIdEnv: "GOOGLE_CLIENT_ID",    clientSecretEnv: "GOOGLE_CLIENT_SECRET" },
  sheets:   { endpoint: "https://oauth2.googleapis.com/token",                           auth: "form", clientIdEnv: "GOOGLE_CLIENT_ID",    clientSecretEnv: "GOOGLE_CLIENT_SECRET" },
  calendar: { endpoint: "https://oauth2.googleapis.com/token",                           auth: "form", clientIdEnv: "GOOGLE_CLIENT_ID",    clientSecretEnv: "GOOGLE_CLIENT_SECRET" },
  docs:     { endpoint: "https://oauth2.googleapis.com/token",                           auth: "form", clientIdEnv: "GOOGLE_CLIENT_ID",    clientSecretEnv: "GOOGLE_CLIENT_SECRET" },
  drive:    { endpoint: "https://oauth2.googleapis.com/token",                           auth: "form", clientIdEnv: "GOOGLE_CLIENT_ID",    clientSecretEnv: "GOOGLE_CLIENT_SECRET" },
  hubspot:  { endpoint: "https://api.hubapi.com/oauth/v1/token",                         auth: "form", clientIdEnv: "HUBSPOT_CLIENT_ID",   clientSecretEnv: "HUBSPOT_CLIENT_SECRET" },
  airtable: { endpoint: "https://airtable.com/oauth2/v1/token",                          auth: "basic", clientIdEnv: "AIRTABLE_CLIENT_ID", clientSecretEnv: "AIRTABLE_CLIENT_SECRET" },
  outlook:  { endpoint: "https://login.microsoftonline.com/common/oauth2/v2.0/token",   auth: "form", clientIdEnv: "MICROSOFT_CLIENT_ID",  clientSecretEnv: "MICROSOFT_CLIENT_SECRET" },
  asana:    { endpoint: "https://app.asana.com/-/oauth_token",                           auth: "form", clientIdEnv: "ASANA_CLIENT_ID",     clientSecretEnv: "ASANA_CLIENT_SECRET" },
  typeform: { endpoint: "https://api.typeform.com/oauth/token",                          auth: "form", clientIdEnv: "TYPEFORM_CLIENT_ID",  clientSecretEnv: "TYPEFORM_CLIENT_SECRET" },
};

// Providers with non-expiring tokens — never refresh
const NON_EXPIRING = new Set(["slack", "notion", "github"]);

/**
 * Upsert an OAuth connection: store tokens in Vault and create or update the
 * connections row.  Handles reconnect by reusing the existing row (preserving
 * its UUID so program_connections FK references stay intact) and deleting the
 * old Vault secret.  Uses a timestamped Vault name so the unique constraint is
 * never hit.
 */
export async function upsertOAuthConnection(
  supabase: Client,
  params: {
    userId: string;
    provider: string;
    label: string;
    tokens: StoredTokens;
    scopes: string[];
    metadata: Record<string, unknown>;
  },
): Promise<void> {
  // Timestamped name guarantees uniqueness on every connect/reconnect
  const vaultName = `oauth:${params.userId}:${params.provider}:${params.label}:${Date.now()}`;
  const newVaultId = await storeOAuthTokens(
    supabase,
    params.tokens,
    vaultName,
    `${params.provider} OAuth tokens for user ${params.userId}`,
  );

  // Look up any existing connections rows for this user + label
  const { data: existing } = await supabase
    .from("connections")
    .select("id, vault_secret_id")
    .eq("user_id", params.userId)
    .eq("name", params.label);

  const rows = (existing ?? []) as Array<{ id: string; vault_secret_id: string }>;

  if (rows.length > 0) {
    const [primary, ...extras] = rows;

    // Delete old Vault secret for the primary row (best-effort)
    try { await vaultDelete(supabase, primary.vault_secret_id); } catch { /* ok */ }

    // Clean up any duplicate rows (shouldn't normally exist)
    for (const extra of extras) {
      try { await vaultDelete(supabase, extra.vault_secret_id); } catch { /* ok */ }
      await supabase.from("connections").delete().eq("id", extra.id);
    }

    // Update the primary row in-place (preserves its UUID → program_connections stay intact)
    const { error } = await supabase
      .from("connections")
      .update({
        vault_secret_id: newVaultId,
        scopes: params.scopes,
        metadata: params.metadata,
        is_valid: true,
        last_validated_at: new Date().toISOString(),
      })
      .eq("id", primary.id);
    if (error) throw new Error(`DB update failed: ${error.message}`);
  } else {
    const { error } = await supabase.from("connections").insert({
      user_id: params.userId,
      name: params.label,
      provider: params.provider,
      auth_type: "oauth",
      vault_secret_id: newVaultId,
      scopes: params.scopes,
      metadata: params.metadata,
      is_valid: true,
      last_validated_at: new Date().toISOString(),
    });
    if (error) throw new Error(`DB insert failed: ${error.message}`);
  }
}

/**
 * Store OAuth tokens in Vault, adding expires_at for refresh tracking.
 * All OAuth callbacks should use this instead of vaultStore(JSON.stringify(tokens)) directly.
 */
export async function storeOAuthTokens(
  supabase: Client,
  tokens: StoredTokens,
  name: string,
  description?: string
): Promise<string> {
  const withExpiry: StoredTokens = {
    ...tokens,
    expires_at: tokens.expires_in
      ? Date.now() + tokens.expires_in * 1000
      : undefined,
  };
  return vaultStore(supabase, JSON.stringify(withExpiry), name, description);
}

/**
 * Update tokens in an existing Vault secret (for refresh).
 * Re-stores the secret with the same name by deleting + re-inserting.
 * Since vault_store_secret creates a new record, we update the connection row's vault_secret_id.
 */
async function rotateVaultTokens(
  supabase: Client,
  connectionId: string,
  vaultSecretId: string,
  newTokens: StoredTokens,
  vaultName: string
): Promise<string> {
  const withExpiry: StoredTokens = {
    ...newTokens,
    expires_at: newTokens.expires_in
      ? Date.now() + newTokens.expires_in * 1000
      : Date.now() + 3600 * 1000, // default 1h if not specified
  };

  // Delete the old vault secret first so the name slot is free for re-use.
  // Ignore errors — the old record may have already been deleted or the id stale.
  try {
    await vaultDelete(supabase, vaultSecretId);
  } catch {
    // non-fatal
  }

  // Store new tokens (creates a new vault record)
  const newVaultId = await vaultStore(
    supabase,
    JSON.stringify(withExpiry),
    vaultName,
    "Refreshed OAuth tokens"
  );

  // Update connection row to point to new vault record
  await supabase
    .from("connections")
    .update({
      vault_secret_id: newVaultId,
      is_valid: true,
      last_validated_at: new Date().toISOString(),
    })
    .eq("id", connectionId);

  return newVaultId;
}

/**
 * Retrieve a valid access token for a connection, refreshing if near expiry.
 * This is the only function the rest of the app should call for OAuth tokens.
 */
export async function getValidOAuthToken(
  supabase: Client,
  connectionId: string,
  forceRefresh = false,
): Promise<string> {
  // Fetch connection row
  const { data: conn, error: connErr } = await supabase
    .from("connections")
    .select("id, provider, vault_secret_id, metadata")
    .eq("id", connectionId)
    .single();

  if (connErr || !conn) throw new Error(`Connection ${connectionId} not found${connErr ? `: ${connErr.message}` : ""}`);

  type ConnRow = { id: string; provider: string; vault_secret_id: string; metadata: Record<string, unknown> | null };
  const connection = conn as unknown as ConnRow;

  // Non-expiring providers — just return the token directly
  if (NON_EXPIRING.has(connection.provider)) {
    const raw = await vaultRetrieve(supabase, connection.vault_secret_id);
    const tokens: StoredTokens = JSON.parse(raw);
    return tokens.access_token;
  }

  const raw = await vaultRetrieve(supabase, connection.vault_secret_id);
  let tokens: StoredTokens;
  try {
    tokens = JSON.parse(raw);
  } catch {
    throw new Error(`Vault secret for connection ${connectionId} (provider: ${connection.provider}) contains invalid JSON — the token may be corrupted. Please reconnect.`);
  }

  // Check if token is still valid (with threshold)
  const nowMs = Date.now();
  const expiresAt = tokens.expires_at;
  const isValid = !forceRefresh && (expiresAt
    ? expiresAt > nowMs + REFRESH_THRESHOLD_SECONDS * 1000
    : false); // no expiry stored → assume stale, attempt refresh

  if (isValid) return tokens.access_token;

  // Attempt refresh
  if (!tokens.refresh_token) {
    // Can't refresh — mark connection invalid
    await supabase
      .from("connections")
      .update({ is_valid: false })
      .eq("id", connectionId);
    throw new Error(`Connection ${connection.provider} token is expired and has no refresh token. Please reconnect.`);
  }

  const config = PROVIDER_REFRESH[connection.provider];
  if (!config) {
    // Unknown provider — return as-is
    return tokens.access_token;
  }

  const clientId = process.env[config.clientIdEnv];
  const clientSecret = process.env[config.clientSecretEnv];
  if (!clientId || !clientSecret) {
    throw new Error(`Missing OAuth credentials for provider ${connection.provider}`);
  }

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: tokens.refresh_token,
    ...(config.auth === "form" ? { client_id: clientId, client_secret: clientSecret } : {}),
  });

  const headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded" };
  if (config.auth === "basic") {
    headers["Authorization"] = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
  }

  const refreshRes = await fetch(config.endpoint, { method: "POST", headers, body });

  if (!refreshRes.ok) {
    const errText = await refreshRes.text();
    await supabase.from("connections").update({ is_valid: false }).eq("id", connectionId);
    throw new Error(`Token refresh failed for ${connection.provider} (HTTP ${refreshRes.status}): ${errText}`);
  }

  let refreshed: StoredTokens;
  try {
    refreshed = await refreshRes.json();
  } catch {
    const raw = await refreshRes.text().catch(() => "(unreadable)");
    throw new Error(`Token refresh for ${connection.provider} returned non-JSON: ${raw.slice(0, 200)}`);
  }
  if (!refreshed.access_token) {
    throw new Error(`Token refresh for ${connection.provider} succeeded but response has no access_token. Keys: ${Object.keys(refreshed).join(", ")}`);
  }

  // Preserve the existing refresh_token if provider didn't return a new one
  const newTokens: StoredTokens = {
    ...tokens,
    ...refreshed,
    refresh_token: refreshed.refresh_token ?? tokens.refresh_token,
  };

  // Each refresh gets a unique name so the vault unique constraint is never hit.
  const vaultName = `oauth:${connectionId}:${Date.now()}`;
  await rotateVaultTokens(supabase, connectionId, connection.vault_secret_id, newTokens, vaultName);

  return newTokens.access_token;
}
