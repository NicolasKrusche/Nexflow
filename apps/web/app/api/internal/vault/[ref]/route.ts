import { NextResponse } from "next/server";
import { apiError, createServiceClient } from "@/lib/api";
import { vaultRetrieve } from "@/lib/vault";

// GET /api/internal/vault/[ref]
// Called by the Python runtime to resolve API key refs.
// Header: x-runtime-secret: <RUNTIME_SECRET>
// Returns: { value: string }
// ref is the api_key id (UUID) — looks up vault_secret_id, fetches from Vault
export async function GET(
  request: Request,
  { params }: { params: { ref: string } }
) {
  // Verify runtime secret
  const incomingSecret = request.headers.get("x-runtime-secret");
  const expectedSecret = process.env.RUNTIME_SECRET;
  if (!expectedSecret || incomingSecret !== expectedSecret) {
    return apiError("Unauthorized", 401);
  }

  const { ref } = params;
  if (!ref) return apiError("Missing ref", 400);

  const serviceClient = createServiceClient();

  // Look up the api_key row to get vault_secret_id
  type ApiKeyRow = { id: string; vault_secret_id: string | null };

  const { data: rawRow, error: keyError } = await serviceClient
    .from("api_keys")
    .select("id, vault_secret_id")
    .eq("id", ref)
    .single();

  if (keyError || !rawRow) {
    return apiError("API key not found", 404);
  }

  const row = rawRow as unknown as ApiKeyRow;

  if (!row.vault_secret_id) {
    return apiError("API key has no vault secret", 404);
  }

  // Retrieve from Vault — value is never logged
  let value: string;
  try {
    value = await vaultRetrieve(serviceClient, row.vault_secret_id);
  } catch {
    return apiError("Failed to retrieve secret from vault", 500);
  }

  return NextResponse.json({ value });
}
