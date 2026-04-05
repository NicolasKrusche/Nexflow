import { NextResponse } from "next/server";
import { z } from "zod";
import { createServerClient } from "@/lib/supabase/server";
import { apiError } from "@/lib/api";
import { ProgramSchemaZ } from "@flowos/schema";

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

// PATCH /api/programs/:id — update schema or metadata
export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiError("Unauthorized", 401);

  const body = await request.json().catch(() => null);
  if (!body) return apiError("Invalid body", 400);

  const allowed = z
    .object({
      name: z.string().min(1).optional(),
      description: z.string().optional(),
      schema: ProgramSchemaZ.optional(),
      is_active: z.boolean().optional(),
      execution_mode: z.enum(["autonomous", "supervised", "manual"]).optional(),
    })
    .safeParse(body);

  if (!allowed.success) return apiError(allowed.error.message, 400);

  const { data, error } = await supabase
    .from("programs")
    .update({ ...allowed.data, updated_at: new Date().toISOString() })
    .eq("id", params.id)
    .eq("user_id", user.id)
    .select("id, name, description, execution_mode, is_active, schema_version, updated_at")
    .single();

  if (error) return apiError(error.message, 500);
  return NextResponse.json(data);
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
