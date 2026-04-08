import { NextResponse } from "next/server";
import { apiError, createServiceClient } from "@/lib/api";
import { headers } from "next/headers";

/**
 * POST /api/internal/runs/[id]/complete
 *
 * Called by the Python runtime when a run finishes (success or failure).
 * Handles:
 *   1. Releasing resource locks for the run
 *   2. Checking for inter-program triggers (downstream programs)
 *   3. Firing downstream runs
 *
 * Secured by x-runtime-secret header.
 */
export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  // Verify runtime secret
  const headersList = await headers();
  const secret = headersList.get("x-runtime-secret");
  const expectedSecret = process.env.RUNTIME_SECRET;
  if (!expectedSecret || secret !== expectedSecret) {
    return apiError("Unauthorized", 401);
  }

  const body = await request.json().catch(() => ({}));
  const { program_id, user_id, status = "completed" } = body as {
    program_id: string;
    user_id: string;
    status?: string;
  };

  if (!program_id || !user_id) {
    return apiError("Missing program_id or user_id", 400);
  }

  const db = createServiceClient();

  // ── 1. Release resource locks ──────────────────────────────────────────────
  await db
    .from("resource_locks")
    .delete()
    .eq("locked_by_run_id", params.id);

  // ── 2. Find downstream program triggers ───────────────────────────────────
  if (status === "completed") {
    const { data: downstreamTriggers } = await db
      .from("triggers")
      .select("id, program_id, config")
      .eq("type", "program")
      .eq("is_active", true);

    if (downstreamTriggers && downstreamTriggers.length > 0) {
      type TriggerRow = { id: string; program_id: string; config: Record<string, unknown> };
      const matching = (downstreamTriggers as unknown as TriggerRow[]).filter(
        (t) => t.config.source_program_id === program_id
      );

      if (matching.length > 0) {
        const runtimeUrl = process.env.RUNTIME_URL ?? "http://localhost:8000";
        const runtimeSecret = process.env.RUNTIME_SECRET ?? "";

        for (const trigger of matching) {
          // Fetch downstream program schema
          const { data: downProgram } = await db
            .from("programs")
            .select("id, schema, user_id, execution_mode, is_active, conflict_policy")
            .eq("id", trigger.program_id)
            .eq("is_active", true)
            .single();

          if (!downProgram) continue;

          type DownProgramRow = {
            id: string;
            schema: unknown;
            user_id: string;
            execution_mode: string;
            conflict_policy: string;
          };
          const prog = downProgram as unknown as DownProgramRow;

          // Check conflict policy
          const { data: activeRuns } = await db
            .from("runs")
            .select("id")
            .eq("program_id", trigger.program_id)
            .in("status", ["running", "paused"])
            .limit(1);

          if (activeRuns && activeRuns.length > 0) {
            if (prog.conflict_policy === "skip" || prog.conflict_policy === "fail") {
              continue; // Skip or fail — don't fire downstream
            }
            // queue: proceed (runtime will queue)
          }

          // Create downstream run
          const { data: downRun } = await db
            .from("runs")
            .insert({
              program_id: trigger.program_id,
              triggered_by: "program",
              trigger_payload: {
                trigger_id: trigger.id,
                source_program_id: program_id,
                source_run_id: params.id,
              },
              status: "running",
              started_at: new Date().toISOString(),
              execution_mode: prog.execution_mode,
            } as never)
            .select("id")
            .single();

          if (!downRun) continue;

          const runId = (downRun as unknown as { id: string }).id;

          // Fire to runtime
          fetch(`${runtimeUrl}/execute`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-runtime-secret": runtimeSecret,
            },
            body: JSON.stringify({
              run_id: runId,
              program_id: trigger.program_id,
              user_id: prog.user_id,
              schema: prog.schema,
              triggered_by: "program",
              trigger_payload: {
                source_program_id: program_id,
                source_run_id: params.id,
              },
            }),
          }).catch(() => {});

          // Update trigger last_fired_at
          await db
            .from("triggers")
            .update({ last_fired_at: new Date().toISOString() })
            .eq("id", trigger.id);
        }
      }
    }
  }

  return NextResponse.json({ ok: true });
}
