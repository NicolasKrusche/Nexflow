import { NextResponse } from "next/server";
import { apiError, createServiceClient } from "@/lib/api";
import { createServerClient } from "@/lib/supabase/server";
import { ProgramSchemaZ } from "@flowos/schema";
import type { ProgramSchema } from "@flowos/schema";
import { validatePostGenesis } from "@/lib/validation";

/**
 * POST /api/browse/[id]/fork
 *
 * Forks a public program into the authenticated user's account.
 * - Copies the sanitized schema (api_key_ref already __USER_ASSIGNED__)
 * - Auto-links connections the user already has by name
 * - Increments the source program's fork_count
 * - Returns the new program + any missing connection names
 */
export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiError("Unauthorized", 401);

  const db = createServiceClient();

  // Fetch the public program (RLS allows reading is_public = true)
  const { data: sourceRaw, error: sourceError } = await db
    .from("programs")
    .select("id, name, description, schema, is_public")
    .eq("id", params.id)
    .eq("is_public", true)
    .single();

  if (sourceError || !sourceRaw) return apiError("Program not found or not public", 404);

  type SourceRow = { id: string; name: string; description: string | null; schema: unknown; is_public: boolean };
  const source = sourceRaw as unknown as SourceRow;

  // Validate the schema (should always be valid, but be defensive)
  const schemaResult = ProgramSchemaZ.safeParse(source.schema);
  if (!schemaResult.success) {
    return apiError("Source program schema is invalid", 422);
  }

  const schema = schemaResult.data as unknown as ProgramSchema;
  const now = new Date().toISOString();

  const forkedName = `${source.name} (fork)`;
  const forkedSchema: ProgramSchema = {
    ...schema,
    program_name: forkedName,
    updated_at: now,
  };

  // Auto-link connections the user already has by name
  type ConnectionRow = { id: string; name: string; provider: string; scopes: string[] | null };

  const referencedNames = getConnectionNames(forkedSchema);
  let matchedConnections: ConnectionRow[] = [];

  if (referencedNames.length > 0) {
    const { data: connsRaw } = await supabase
      .from("connections")
      .select("id, name, provider, scopes")
      .eq("user_id", user.id)
      .in("name", referencedNames);
    matchedConnections = (connsRaw ?? []) as unknown as ConnectionRow[];
  }

  const validation = validatePostGenesis(forkedSchema, matchedConnections);

  // Insert forked program
  const { data: newProgRaw, error: insertError } = await db
    .from("programs")
    .insert({
      user_id: user.id,
      name: forkedName,
      description: source.description ?? null,
      schema: forkedSchema as unknown as Record<string, unknown>,
      execution_mode: mapExecutionMode(forkedSchema.execution_mode),
      is_active: false, // forked programs start inactive until user reviews
      updated_at: now,
    } as unknown as never)
    .select("id, name, description, execution_mode, is_active, schema_version, created_at")
    .single();

  if (insertError || !newProgRaw) return apiError("Failed to fork program", 500);

  const newProg = newProgRaw as unknown as { id: string; name: string };

  // Link matched connections
  if (matchedConnections.length > 0) {
    await db.from("program_connections").insert(
      matchedConnections.map((c) => ({ program_id: newProg.id, connection_id: c.id })) as unknown as never
    );
  }

  // Version snapshot
  await db.from("program_versions").insert({
    program_id: newProg.id,
    version: 0,
    schema: forkedSchema as unknown as Record<string, unknown>,
    change_summary: `Forked from public program "${source.name}" (${source.id})`,
  } as unknown as never);

  // Increment fork_count on the source (best-effort via RPC)
  await db.rpc("increment_fork_count", { program_id: params.id }).catch(() => {});

  const linkedNames = new Set(matchedConnections.map((c) => c.name));
  const missingNames = referencedNames.filter((n) => !linkedNames.has(n));

  return NextResponse.json(
    {
      program: newProgRaw,
      validation,
      linked_connection_names: [...linkedNames],
      missing_connection_names: missingNames,
    },
    { status: 201 }
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getConnectionNames(schema: ProgramSchema): string[] {
  const names = new Set<string>();
  for (const node of schema.nodes) {
    if (node.connection) names.add(node.connection.trim());
  }
  return [...names].filter(Boolean);
}

function mapExecutionMode(mode: ProgramSchema["execution_mode"]): "autonomous" | "supervised" | "manual" {
  return mode === "approval_required" ? "supervised" : mode;
}
