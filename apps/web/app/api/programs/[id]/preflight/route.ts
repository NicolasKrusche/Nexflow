import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { apiError, createServiceClient } from "@/lib/api";
import { validatePreFlight } from "@/lib/validation/pre-flight";
import type { ProgramSchema } from "@flowos/schema";

// POST /api/programs/[id]/preflight — run pre-flight checks before execution
export async function POST(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return apiError("Unauthorized", 401);

  // Fetch the program schema
  const { data: program, error: progError } = await supabase
    .from("programs")
    .select("id, schema")
    .eq("id", params.id)
    .eq("user_id", user.id)
    .single();

  if (progError || !program) return apiError("Program not found", 404);

  const schema = program.schema as unknown as ProgramSchema;

  // Use service client to bypass RLS for Vault-adjacent reads
  const serviceClient = createServiceClient();

  // Fetch connections linked to this program
  const { data: linkedConns } = await serviceClient
    .from("program_connections")
    .select("connection_id")
    .eq("program_id", params.id);

  const connectionIds = (linkedConns ?? []).map((r) => r.connection_id);

  let connections: Array<{
    id: string;
    name: string;
    provider: string;
    scopes: string[] | null;
    is_valid: boolean;
  }> = [];

  if (connectionIds.length > 0) {
    const { data } = await serviceClient
      .from("connections")
      .select("id, name, provider, scopes, is_valid")
      .in("id", connectionIds)
      .eq("user_id", user.id);
    connections = (data ?? []) as typeof connections;
  }

  // Fetch the user's API keys (for PRE_002 — assigned key validity)
  const { data: apiKeys } = await serviceClient
    .from("api_keys")
    .select("id, name, provider, is_valid")
    .eq("user_id", user.id);

  const { result, checks } = await validatePreFlight(
    schema,
    connections,
    (apiKeys ?? []) as Array<{ id: string; name: string; provider: string; is_valid: boolean }>
  );

  return NextResponse.json({ result, checks });
}
