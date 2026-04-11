import { NextResponse } from "next/server";
import { apiError, createServiceClient } from "@/lib/api";

/**
 * POST /api/triggers/webhook/[token]
 *
 * Public endpoint — no auth required (secured by the opaque token in the URL).
 * Receives an inbound webhook, looks up the trigger, creates a run, dispatches
 * to the Python runtime.
 */
export async function POST(
  request: Request,
  { params }: { params: { token: string } }
) {
  const { token } = params;

  const db = createServiceClient();

  // Look up trigger by webhook_token
  type TriggerRow = {
    id: string;
    program_id: string;
    is_active: boolean;
  };

  const { data: triggerRaw, error: triggerError } = await db
    .from("triggers")
    .select("id, program_id, is_active")
    .eq("webhook_token", token)
    .eq("type", "webhook")
    .single();

  if (triggerError || !triggerRaw) {
    // Return generic 404 — don't reveal whether token exists
    return apiError("Not found", 404);
  }

  const trigger = triggerRaw as unknown as TriggerRow;

  if (!trigger.is_active) {
    return apiError("Trigger is disabled", 409);
  }

  // Parse incoming payload (optional body)
  let payload: Record<string, unknown> = {};
  try {
    const text = await request.text();
    if (text) payload = JSON.parse(text);
  } catch {
    // Ignore parse errors — payload is best-effort
  }

  // Fetch program to get schema + user_id
  type ProgramRow = {
    id: string;
    schema: unknown;
    user_id: string;
    execution_mode: string;
    is_active: boolean;
  };

  const { data: programRaw, error: programError } = await db
    .from("programs")
    .select("id, schema, user_id, execution_mode, is_active")
    .eq("id", trigger.program_id)
    .single();

  if (programError || !programRaw) return apiError("Program not found", 404);

  const program = programRaw as unknown as ProgramRow;

  if (!program.is_active) {
    return apiError("Program is not active", 409);
  }

  // Check conflict policy before creating run
  const conflictResult = await _checkAndAcquireSlot(db, program, "webhook");
  if (!conflictResult.allowed) {
    return NextResponse.json(
      { error: "Conflict: " + conflictResult.reason },
      { status: 409 }
    );
  }

  // Create run
  const { data: runRaw, error: runError } = await db
    .from("runs")
    .insert({
      program_id: trigger.program_id,
      triggered_by: "webhook",
      trigger_payload: { trigger_id: trigger.id, webhook_payload: payload },
      status: "running",
      started_at: new Date().toISOString(),
      execution_mode: program.execution_mode,
    } as never)
    .select("id")
    .single();

  if (runError || !runRaw) return apiError("Failed to create run", 500);

  const run = runRaw as unknown as { id: string };

  // Update trigger last_fired_at
  await db
    .from("triggers")
    .update({ last_fired_at: new Date().toISOString() })
    .eq("id", trigger.id);

  // Fetch connection name→id map for this program
  const { data: linkedConnsRaw } = await db
    .from("program_connections")
    .select("connection_id, connections(id, name)")
    .eq("program_id", trigger.program_id);

  const connectionNameToId: Record<string, string> = {};
  for (const row of (linkedConnsRaw ?? []) as Array<{
    connection_id: string;
    connections: { id: string; name: string } | null;
  }>) {
    if (row.connections) connectionNameToId[row.connections.name] = row.connections.id;
  }

  // Dispatch to runtime
  const runtimeUrl = process.env.RUNTIME_URL ?? "http://localhost:8000";
  const runtimeSecret = process.env.RUNTIME_SECRET ?? "";
  const triggerPayload = { trigger_id: trigger.id, webhook_payload: payload };

  try {
    const runtimeRes = await fetch(`${runtimeUrl}/execute`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-runtime-secret": runtimeSecret,
      },
      body: JSON.stringify({
        run_id: run.id,
        program_id: trigger.program_id,
        user_id: program.user_id,
        schema: program.schema,
        triggered_by: "webhook",
        trigger_payload: triggerPayload,
        connections: connectionNameToId,
      }),
      cache: "no-store",
    });
    if (!runtimeRes.ok) {
      await db
        .from("runs")
        .update({ status: "failed", error_message: `Runtime rejected execution (${runtimeRes.status})`, completed_at: new Date().toISOString() })
        .eq("id", run.id);
      return NextResponse.json({ error: "Runtime failed to accept the run" }, { status: 502 });
    }
  } catch {
    await db
      .from("runs")
      .update({ status: "failed", error_message: "Runtime is unreachable", completed_at: new Date().toISOString() })
      .eq("id", run.id);
    return NextResponse.json({ error: "Runtime is unreachable" }, { status: 503 });
  }

  return NextResponse.json({ run_id: run.id, status: "running" }, { status: 202 });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function _checkAndAcquireSlot(
  db: ReturnType<typeof createServiceClient>,
  program: { id: string; execution_mode: string },
  triggeredBy: string
): Promise<{ allowed: boolean; reason?: string }> {
  // Check if there's already a running instance
  const { data: running } = await db
    .from("runs")
    .select("id")
    .eq("program_id", program.id)
    .in("status", ["running", "paused"])
    .limit(1);

  if (!running || running.length === 0) return { allowed: true };

  // There is already a running instance — fetch conflict_policy
  const { data: prog } = await db
    .from("programs")
    .select("conflict_policy")
    .eq("id", program.id)
    .single();

  const policy = (prog as { conflict_policy?: string } | null)?.conflict_policy ?? "queue";

  if (policy === "skip") {
    return { allowed: false, reason: "skip policy: another run is active" };
  }
  if (policy === "fail") {
    return { allowed: false, reason: "fail policy: another run is active" };
  }

  // queue: allowed (runtime handles ordering via the queue)
  return { allowed: true };
}
