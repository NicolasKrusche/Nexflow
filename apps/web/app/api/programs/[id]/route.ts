import { NextResponse } from "next/server";
import { z } from "zod";
import { createServerClient } from "@/lib/supabase/server";
import { apiError } from "@/lib/api";
import { ProgramSchemaZ } from "@flowos/schema";
import type { ProgramSchema } from "@flowos/schema";
import { validatePostGenesis } from "@/lib/validation";

// GET /api/programs/:id — full schema
export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiError("Unauthorized", 401);

  const { data, error } = await supabase
    .from("programs")
    .select("*")
    .eq("id", params.id)
    .eq("user_id", user.id)
    .single();

  if (error || !data) return apiError("Program not found", 404);
  return NextResponse.json(data);
}

// PATCH /api/programs/:id — save updated schema from the visual editor
export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiError("Unauthorized", 401);

  const body = await request.json().catch(() => null);
  if (!body) return apiError("Invalid body", 400);

  const bodySchema = z.object({
    schema: ProgramSchemaZ.optional(),
    name: z.string().min(1).optional(),
    description: z.string().optional(),
    is_active: z.boolean().optional(),
    execution_mode: z.enum(["autonomous", "approval_required", "supervised"]).optional(),
  });

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return apiError(parsed.error.message, 400);

  // Verify ownership and get current version number
  // Cast through unknown to handle Supabase's generated `never` types
  type ExistingRow = { id: string; schema_version: number | null };

  const { data: rawExisting, error: fetchError } = await supabase
    .from("programs")
    .select("id, schema_version")
    .eq("id", params.id)
    .eq("user_id", user.id)
    .single();

  if (fetchError || !rawExisting) return apiError("Program not found", 404);

  const existing = rawExisting as unknown as ExistingRow;
  const { schema: rawSchema, ...metaPatch } = parsed.data;

  // Cast Zod output to ProgramSchema — the type discrepancy is in DataSchema.properties
  // (Zod output: Record<string,unknown>, ProgramSchema: {[key:string]:DataSchema})
  // which are structurally identical at runtime.
  const schema = rawSchema as unknown as ProgramSchema | undefined;

  // ── If schema was provided, validate it ────────────────────────────────────

  let validationResult = null;
  if (schema) {
    validationResult = validatePostGenesis(schema, []);
  }

  const now = new Date().toISOString();
  const nextVersion = (existing.schema_version ?? 0) + 1;

  // ── Update program row ─────────────────────────────────────────────────────
  // Build update payload and cast to satisfy Supabase's strict type checker

  const updatePayload = {
    ...metaPatch,
    updated_at: now,
    ...(schema ? { schema: schema as unknown, schema_version: nextVersion } : {}),
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

  // ── Insert version snapshot (only when schema was saved) ──────────────────

  if (schema) {
    await supabase
      .from("program_versions")
      .insert({
        program_id: params.id,
        version: nextVersion,
        schema: schema as unknown,
        change_summary: "Saved from visual editor",
      } as unknown as never);
    // Ignore version insert errors — non-fatal
  }

  return NextResponse.json({
    program: updatedProgram,
    validation: validationResult,
  });
}

// DELETE /api/programs/:id
export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiError("Unauthorized", 401);

  const { error } = await supabase
    .from("programs")
    .delete()
    .eq("id", params.id)
    .eq("user_id", user.id);

  if (error) return apiError(error.message, 500);
  return new NextResponse(null, { status: 204 });
}
