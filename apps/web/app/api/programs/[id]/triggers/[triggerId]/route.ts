import { NextResponse } from "next/server";
import { CronExpressionParser } from "cron-parser"; // fix: cron-parser v5 exports CronExpressionParser, not parseExpression
import { apiError, createServiceClient, getAuthUser } from "@/lib/api";
import { createServerClient } from "@/lib/supabase/server";

// ─── PATCH /api/programs/[id]/triggers/[triggerId] — toggle or update ────────

export async function PATCH(
  request: Request,
  { params }: { params: { id: string; triggerId: string } }
) {
  const user = await getAuthUser();
  if (!user) return apiError("Unauthorized", 401);

  // Verify program ownership
  const supabase = await createServerClient();
  const { data: program, error: progError } = await supabase
    .from("programs")
    .select("id")
    .eq("id", params.id)
    .eq("user_id", user.id)
    .single();
  if (progError || !program) return apiError("Program not found", 404);

  const body = await request.json().catch(() => ({}));

  const serviceClient = createServiceClient();

  // Build update payload
  type UpdatePayload = {
    is_active?: boolean;
    config?: Record<string, unknown>;
    next_run_at?: string | null;
    updated_at: string;
  };
  const updates: UpdatePayload = { updated_at: new Date().toISOString() };

  if (typeof body.is_active === "boolean") {
    updates.is_active = body.is_active;
  }

  if (body.config && typeof body.config === "object") {
    updates.config = body.config;
    // Recompute next_run_at if cron expression changed
    const expr = (body.config as Record<string, unknown>).expression as string | undefined;
    if (expr) {
      try {
        const timezone = ((body.config as Record<string, unknown>).timezone as string) ?? "UTC";
        const interval = CronExpressionParser.parse(expr, { tz: timezone });
        updates.next_run_at = interval.next().toISOString();
      } catch {
        return apiError("Invalid cron expression", 400);
      }
    }
  }

  const { data, error } = await serviceClient
    .from("triggers")
    .update(updates as never)
    .eq("id", params.triggerId)
    .eq("program_id", params.id)
    .select("id, type, config, is_active, next_run_at, last_fired_at, updated_at")
    .single();

  if (error || !data) return apiError("Trigger not found or update failed", 404);

  return NextResponse.json({ trigger: data });
}

// ─── DELETE /api/programs/[id]/triggers/[triggerId] ───────────────────────────

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string; triggerId: string } }
) {
  const user = await getAuthUser();
  if (!user) return apiError("Unauthorized", 401);

  // Verify program ownership
  const supabase = await createServerClient();
  const { data: program, error: progError } = await supabase
    .from("programs")
    .select("id")
    .eq("id", params.id)
    .eq("user_id", user.id)
    .single();
  if (progError || !program) return apiError("Program not found", 404);

  const serviceClient = createServiceClient();
  const { error } = await serviceClient
    .from("triggers")
    .delete()
    .eq("id", params.triggerId)
    .eq("program_id", params.id);

  if (error) return apiError(error.message, 500);

  return new Response(null, { status: 204 });
}
