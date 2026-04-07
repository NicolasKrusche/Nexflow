import { NextResponse } from "next/server";
import { z } from "zod";
import { createServerClient } from "@/lib/supabase/server";
import { apiError } from "@/lib/api";
import { ProgramSchemaZ } from "@flowos/schema";
import type { ProgramSchema } from "@flowos/schema";
import { validatePostGenesis } from "@/lib/validation";

// ─── GET /api/programs/:id/versions ──────────────────────────────────────────
// Returns all version snapshots for this program, newest first.
// Only returns lightweight metadata — no full schema (too large for a list).

export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return apiError("Unauthorized", 401);

  // Verify ownership
  const { data: program, error: programError } = await supabase
    .from("programs")
    .select("id")
    .eq("id", params.id)
    .eq("user_id", user.id)
    .single();

  if (programError || !program) return apiError("Program not found", 404);

  // Fetch version rows — newest first, omit full schema column
  const { data: versions, error: versionsError } = await supabase
    .from("program_versions")
    .select("id, version, change_summary, created_at")
    .eq("program_id", params.id)
    .order("version", { ascending: false });

  if (versionsError) return apiError(versionsError.message, 500);

  return NextResponse.json({ versions: versions ?? [] });
}

// ─── POST /api/programs/:id/versions ─────────────────────────────────────────
// Rollback: fetch the requested version's schema, save it as the current schema,
// increment schema_version, and insert a new snapshot noting the rollback.

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return apiError("Unauthorized", 401);

  const body = await request.json().catch(() => null);
  if (!body) return apiError("Invalid body", 400);

  const bodySchema = z.object({ version: z.number().int().min(0) });
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return apiError(parsed.error.message, 400);

  const { version: targetVersion } = parsed.data;

  // Verify ownership and get current version number
  type ExistingRow = { id: string; schema_version: number | null };

  const { data: rawExisting, error: fetchError } = await supabase
    .from("programs")
    .select("id, schema_version")
    .eq("id", params.id)
    .eq("user_id", user.id)
    .single();

  if (fetchError || !rawExisting) return apiError("Program not found", 404);

  const existing = rawExisting as unknown as ExistingRow;

  // Fetch the target version's full schema
  type VersionRow = { schema: unknown };

  const { data: rawVersionRow, error: versionFetchError } = await supabase
    .from("program_versions")
    .select("schema")
    .eq("program_id", params.id)
    .eq("version", targetVersion)
    .single();

  if (versionFetchError || !rawVersionRow)
    return apiError(`Version ${targetVersion} not found`, 404);

  const versionRow = rawVersionRow as unknown as VersionRow;

  // Validate the restored schema
  const parsedSchema = ProgramSchemaZ.safeParse(versionRow.schema);
  if (!parsedSchema.success) return apiError("Stored schema is invalid", 500);

  // Cast is safe — Zod output is structurally identical to ProgramSchema at runtime
  const restoredSchema = parsedSchema.data as unknown as ProgramSchema;
  const validationResult = validatePostGenesis(restoredSchema, []);

  const now = new Date().toISOString();
  const nextVersion = (existing.schema_version ?? 0) + 1;
  const changeSummary = `Rolled back to version ${targetVersion}`;

  // Update program row with restored schema
  const updatePayload = {
    schema: restoredSchema as unknown,
    schema_version: nextVersion,
    updated_at: now,
  };

  const { data: updatedProgram, error: updateError } = await supabase
    .from("programs")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .update(updatePayload as unknown as never)
    .eq("id", params.id)
    .eq("user_id", user.id)
    .select("id, name, description, execution_mode, is_active, schema_version, updated_at")
    .single();

  if (updateError) return apiError(updateError.message, 500);

  // Insert new version snapshot recording the rollback
  await supabase
    .from("program_versions")
    .insert({
      program_id: params.id,
      version: nextVersion,
      schema: restoredSchema as unknown,
      change_summary: changeSummary,
    } as unknown as never);

  return NextResponse.json({
    program: updatedProgram,
    schema: restoredSchema,
    validation: validationResult,
  });
}
