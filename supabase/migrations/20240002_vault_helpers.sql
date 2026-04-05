-- Vault helper RPC functions
-- These wrap pgsodium/vault calls to keep the interface clean.
-- All functions are SECURITY DEFINER so they run with elevated privileges.

-- Store a secret in the Vault and return its UUID
CREATE OR REPLACE FUNCTION public.vault_store_secret(
  p_secret      TEXT,
  p_name        TEXT,
  p_description TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  v_id UUID;
BEGIN
  SELECT vault.create_secret(p_secret, p_name, p_description) INTO v_id;
  RETURN v_id;
END;
$$;

-- Retrieve a secret value from the Vault by its UUID
CREATE OR REPLACE FUNCTION public.vault_retrieve_secret(p_secret_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  v_secret TEXT;
BEGIN
  SELECT decrypted_secret
  INTO v_secret
  FROM vault.decrypted_secrets
  WHERE id = p_secret_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Secret not found: %', p_secret_id;
  END IF;

  RETURN v_secret;
END;
$$;

-- Delete a secret from the Vault
CREATE OR REPLACE FUNCTION public.vault_delete_secret(p_secret_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
BEGIN
  DELETE FROM vault.secrets WHERE id = p_secret_id;
END;
$$;

-- Revoke direct access — only the app can call these via service role
REVOKE ALL ON FUNCTION public.vault_store_secret FROM PUBLIC;
REVOKE ALL ON FUNCTION public.vault_retrieve_secret FROM PUBLIC;
REVOKE ALL ON FUNCTION public.vault_delete_secret FROM PUBLIC;
