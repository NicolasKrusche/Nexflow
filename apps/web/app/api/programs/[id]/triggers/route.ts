import { NextResponse } from "next/server";
import { CronExpressionParser } from "cron-parser"; // fix: cron-parser v5 exports CronExpressionParser, not parseExpression
import { apiError, createServiceClient, getAuthUser } from "@/lib/api";
import { createServerClient } from "@/lib/supabase/server";

// ─── Types ────────────────────────────────────────────────────────────────────

type TriggerRow = {
  id: string;
  program_id: string;
  type: string;
  config: Record<string, unknown>;
  is_active: boolean;
  webhook_token: string | null;
  next_run_at: string | null;
  last_fired_at: string | null;
  created_at: string;
};

// ─── GET /api/programs/[id]/triggers ─────────────────────────────────────────

export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const user = await getAuthUser();
  if (!user) return apiError("Unauthorized", 401);

  // Verify ownership
  const supabase = await createServerClient();
  const { data: program, error: progError } = await supabase
    .from("programs")
    .select("id")
    .eq("id", params.id)
    .eq("user_id", user.id)
    .single();
  if (progError || !program) return apiError("Program not found", 404);

  const serviceClient = createServiceClient();
  const { data, error } = await serviceClient
    .from("triggers")
    .select("id, program_id, type, config, is_active, webhook_token, next_run_at, last_fired_at, created_at")
    .eq("program_id", params.id)
    .order("created_at", { ascending: false });

  if (error) return apiError(error.message, 500);

  const triggers = (data ?? []) as unknown as TriggerRow[];

  // Build webhook URLs (server-side, never expose token to unauth parties)
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const enriched = triggers.map((t) => ({
    ...t,
    webhook_url:
      t.type === "webhook" && t.webhook_token
        ? `${appUrl}/api/triggers/webhook/${t.webhook_token}`
        : null,
    // Never expose webhook_token directly — use the full URL instead
    webhook_token: undefined,
  }));

  return NextResponse.json({ triggers: enriched });
}

// ─── POST /api/programs/[id]/triggers ────────────────────────────────────────

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const user = await getAuthUser();
  if (!user) return apiError("Unauthorized", 401);

  // Verify ownership
  const supabase = await createServerClient();
  const { data: program, error: progError } = await supabase
    .from("programs")
    .select("id")
    .eq("id", params.id)
    .eq("user_id", user.id)
    .single();
  if (progError || !program) return apiError("Program not found", 404);

  const body = await request.json().catch(() => null);
  if (!body || typeof body.type !== "string") {
    return apiError("Missing type", 400);
  }

  const { type, config = {} } = body as { type: string; config?: Record<string, unknown> };

  const validTypes = ["manual", "cron", "webhook", "event", "program"];
  if (!validTypes.includes(type)) {
    return apiError(`Invalid type. Must be one of: ${validTypes.join(", ")}`, 400);
  }

  // Validate cron expression if provided
  let nextRunAt: string | null = null;
  if (type === "cron") {
    const expr = config.expression as string | undefined;
    if (!expr) return apiError("Cron trigger requires config.expression", 400);
    try {
      const timezone = (config.timezone as string) ?? "UTC";
      const interval = CronExpressionParser.parse(expr, { tz: timezone });
      nextRunAt = interval.next().toISOString();
    } catch {
      return apiError("Invalid cron expression", 400);
    }
  }

  if (type === "program" && !config.source_program_id) {
    return apiError("Program trigger requires config.source_program_id", 400);
  }

  const serviceClient = createServiceClient();
  const { data, error } = await serviceClient
    .from("triggers")
    .insert({
      program_id: params.id,
      type,
      config,
      is_active: true,
      next_run_at: nextRunAt,
    } as never)
    .select("id, program_id, type, config, is_active, webhook_token, next_run_at, last_fired_at, created_at")
    .single();

  if (error || !data) return apiError("Failed to create trigger", 500);

  const trigger = data as unknown as TriggerRow;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  return NextResponse.json(
    {
      trigger: {
        ...trigger,
        webhook_url:
          trigger.type === "webhook" && trigger.webhook_token
            ? `${appUrl}/api/triggers/webhook/${trigger.webhook_token}`
            : null,
        webhook_token: undefined,
      },
    },
    { status: 201 }
  );
}
