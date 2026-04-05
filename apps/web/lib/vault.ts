import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@flowos/db";

type Client = SupabaseClient<Database>;

/**
 * Store a secret in Supabase Vault.
 * Returns the vault secret ID (UUID) to be stored in the application tables.
 * The raw secret value is NEVER stored in application tables.
 */
export async function vaultStore(
  supabase: Client,
  secret: string,
  name: string,
  description?: string
): Promise<string> {
  const { data, error } = await supabase.rpc("vault_store_secret", {
    p_secret: secret,
    p_name: name,
    p_description: description ?? null,
  });
  if (error) throw new Error(`Vault store failed: ${error.message}`);
  return data as string;
}

/**
 * Retrieve a secret value from Supabase Vault by its UUID.
 * Only callable server-side with the service role key.
 */
export async function vaultRetrieve(supabase: Client, vaultSecretId: string): Promise<string> {
  const { data, error } = await supabase.rpc("vault_retrieve_secret", {
    p_secret_id: vaultSecretId,
  });
  if (error) throw new Error(`Vault retrieve failed: ${error.message}`);
  return data as string;
}

/**
 * Delete a secret from Supabase Vault.
 */
export async function vaultDelete(supabase: Client, vaultSecretId: string): Promise<void> {
  const { error } = await supabase.rpc("vault_delete_secret", {
    p_secret_id: vaultSecretId,
  });
  if (error) throw new Error(`Vault delete failed: ${error.message}`);
}
