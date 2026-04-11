import { NonRetriableError } from "inngest";
import { parseExpression } from "cron-parser";
import { inngest } from "@/lib/inngest";
import { createServiceClient } from "@/lib/api";

/**
 * Inngest function: runs every minute, finds all active cron triggers that are
 * due to fire, dispatches a run for each, then updates next_run_at.
 */
export const cronRunner = inngest.createFunction(
  { id: "cron-runner", name: "Cron Trigger Runner" },
  { cron: "* * * * *" }, // Every minute
  async ({ step, logger }) => {
    const db = createServiceClient();

    // ── 1. Find all due cron triggers ──────────────────────────────────────
    const due = await step.run("fetch-due-triggers", async () => {
      const { data, error } = await db
        .from("triggers")
        .select("id, program_id, config")
        .eq("type", "cron")
        .eq("is_active", true)
        .lte("next_run_at", new Date().toISOString());

      if (error) throw new NonRetriableError(`DB error: ${error.message}`);
      return (data ?? []) as Array<{
        id: string;
        program_id: string;
        config: Record<string, unknown>;
      }>;
    });

    if (due.length === 0) return { fired: 0 };

    // ── 2. For each due trigger, dispatch a run ────────────────────────────
    const runtimeUrl = process.env.RUNTIME_URL ?? "http://localhost:8000";
    const runtimeSecret = process.env.RUNTIME_SECRET ?? "";
    const nextjsUrl = process.env.NEXTJS_INTERNAL_URL ?? "http://localhost:3000";

    let fired = 0;

    for (const trigger of due) {
      await step.run(`dispatch-${trigger.id}`, async () => {
        // Fetch program schema + user_id
        const { data: program, error: progErr } = await db
          .from("programs")
          .select("id, schema, user_id, execution_mode")
          .eq("id", trigger.program_id)
          .eq("is_active", true)
          .single();

        if (progErr || !program) {
          logger.warn(`Skipping trigger ${trigger.id}: program not found or inactive`);
          return;
        }

        // Insert run row
        const { data: run, error: runErr } = await db
          .from("runs")
          .insert({
            program_id: trigger.program_id,
            triggered_by: "cron",
            trigger_payload: { trigger_id: trigger.id },
            status: "running",
            started_at: new Date().toISOString(),
            execution_mode: (program as Record<string, unknown>).execution_mode ?? "autonomous",
          } as never)
          .select("id")
          .single();

        if (runErr || !run) {
          logger.error(`Failed to create run for trigger ${trigger.id}`);
          return;
        }

        // Fire-and-forget to Python runtime
        fetch(`${runtimeUrl}/execute`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-runtime-secret": runtimeSecret,
          },
          body: JSON.stringify({
            run_id: (run as { id: string }).id,
            program_id: trigger.program_id,
            user_id: (program as Record<string, unknown>).user_id,
            schema: (program as Record<string, unknown>).schema,
            triggered_by: "cron",
            trigger_payload: { trigger_id: trigger.id },
          }),
          cache: "no-store",
        }).catch(() => {});

        fired++;

        // Update last_fired_at and compute next_run_at
        const expr = (trigger.config as Record<string, unknown>).expression as string;
        const timezone = ((trigger.config as Record<string, unknown>).timezone as string) ?? "UTC";
        let nextRun: string | null = null;
        try {
          const interval = parseExpression(expr, {
            currentDate: new Date(),
            tz: timezone,
          });
          nextRun = interval.next().toISOString();
        } catch {
          logger.warn(`Invalid cron expression for trigger ${trigger.id}: ${expr}`);
        }

        await db
          .from("triggers")
          .update({
            last_fired_at: new Date().toISOString(),
            next_run_at: nextRun,
          })
          .eq("id", trigger.id);
      });
    }

    return { fired };
  }
);
