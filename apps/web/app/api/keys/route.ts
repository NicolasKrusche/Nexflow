import { NextResponse } from "next/server";
import { z } from "zod";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceClient, apiError } from "@/lib/api";
import { vaultStore } from "@/lib/vault";

const CreateKeySchema = z.object({
  name: z.string().min(1).max(100),
  provider: z.string().min(1).max(50),
  key: z.string().min(10),
});

// GET /api/keys — list user's API keys (no secret values)
export async function GET() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiError("Unauthorized", 401);

  const { data, error } = await supabase
    .from("api_keys")
    .select("id, name, provider, is_valid, last_validated_at, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) return apiError(error.message, 500);
  return NextResponse.json(data);
}

// POST /api/keys — add a new API key (stores value in Vault)
export async function POST(request: Request) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiError("Unauthorized", 401);

  const body = await request.json().catch(() => null);
  const parsed = CreateKeySchema.safeParse(body);
  if (!parsed.success) return apiError(parsed.error.message, 400);

  const { name, provider, key } = parsed.data;
  const serviceClient = createServiceClient();

  let vaultId: string;
  try {
    vaultId = await vaultStore(
      serviceClient,
      key,
      `apikey:${user.id}:${provider}:${name}`,
      `API key for ${provider} — user ${user.id}`
    );
  } catch (err) {
    return apiError(`Failed to store key securely: ${(err as Error).message}`, 500);
  }

  const { data, error } = await supabase
    .from("api_keys")
    .insert({
      user_id: user.id,
      name,
      provider,
      vault_secret_id: vaultId,
    })
    .select("id, name, provider, is_valid, last_validated_at, created_at")
    .single();

  if (error) return apiError(error.message, 500);
  return NextResponse.json(data, { status: 201 });
}
