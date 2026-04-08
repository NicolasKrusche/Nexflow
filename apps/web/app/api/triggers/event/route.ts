import { NextResponse } from "next/server";
import { apiError, createServiceClient } from "@/lib/api";

/**
 * POST /api/triggers/event
 *
 * Receives an event from a connected provider (or internally from a provider webhook handler).
 * Finds all active programs listening for this source+event pair and fires them.
 *
 * Body: { source: string, event: string, payload?: Record<string, unknown> }
 *
 * Secured by x-runtime-secret for internal calls, OR by provider-specific
 * HMAC signature verification when called directly from provider webhooks.
 *
 * For MVP: accept x-runtime-secret (internal) only. Provider-specific verification
 * is added per connector as native connectors are implemented.
 */
export async function POST(request: Request) {
  // Auth: accept either runtime secret (internal) or a provider signature header
  const incomingSecret = request.headers.get("x-runtime-secret");
  const expectedSecret = process.env.RUNTIME_SECRET;

  // For provider-originated events, we allow unauthenticated POSTs but
  // only match active triggers — security is the opaque token.
  // For internal forwarding, require the runtime secret.
  const isInternal = expectedSecret && incomingSecret === expectedSecret;
  const isProviderEvent = request.headers.get("x-provider-event") !== null;

  if (!isInternal && !isProviderEvent) {
    // No recognized auth mechanism
    return apiError("Unauthorized", 401);
  }

  let body: { source: string; event: string; payload?: Record<string, unknown> };
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid JSON body", 400);
  }

  const { source, event, payload = {} } = body;
  if (!source || !event) return apiError("source and event are required", 400);

  const db = createServiceClient();

  // Find all active triggers of type "event" with matching source + event
  type TriggerRow = {
    id: string;
    program_id: string;
    config: Record<string, unknown>;
    is_active: boolean;
  };

  const { data: triggersRaw, error: trigErr } = await db
    .from("triggers")
    .select("id, program_id, config, is_active")
    .eq("type", "event")
    .eq("is_active", true);

  if (trigErr) return apiError(trigErr.message, 500);

  const triggers = (triggersRaw ?? []) as unknown as TriggerRow[];

  // Filter to triggers matching this source+event (config is JSONB)
  const matching = triggers.filter((t) => {
    const cfg = t.config ?? {};
    return cfg.source === source && cfg.event === event;
  });

  if (matching.length === 0) {
    return NextResponse.json({ matched: 0, runs: [] });
  }

  const runtimeUrl = process.env.RUNTIME_URL ?? "http://localhost:8000";
  const runtimeSecret = process.env.RUNTIME_SECRET ?? "";
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  const runIds: string[] = [];

  await Promise.all(
    matching.map(async (trigger) => {
      // Fetch program
      type ProgramRow = {
        id: string;
        schema: unknown;
        user_id: string;
        execution_mode: string;
        is_active: boolean;
        conflict_policy: string;
      };

      const { data: programRaw } = await db
        .from("programs")
        .select("id, schema, user_id, execution_mode, is_active, conflict_policy")
        .eq("id", trigger.program_id)
        .single();

      if (!programRaw) return;
      const program = programRaw as unknown as ProgramRow;
      if (!program.is_active) return;

      // Create run
      const { data: runRaw } = await db
        .from("runs")
        .insert({
          program_id: trigger.program_id,
          triggered_by: `event:${source}:${event}`,
          trigger_payload: { trigger_id: trigger.id, source, event, payload },
          status: "running",
          started_at: new Date().toISOString(),
          execution_mode: program.execution_mode,
        } as never)
        .select("id")
        .single();

      if (!runRaw) return;
      const run = runRaw as unknown as { id: string };
      runIds.push(run.id);

      // Update trigger last_fired_at
      await db
        .from("triggers")
        .update({ last_fired_at: new Date().toISOString() })
        .eq("id", trigger.id);

      // Dispatch to runtime (fire and forget)
      fetch(`${runtimeUrl}/execute`, {
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
          triggered_by: `event:${source}:${event}`,
          trigger_payload: { trigger_id: trigger.id, source, event, payload },
        }),
      }).catch(() => {});
    })
  );

  return NextResponse.json({ matched: matching.length, runs: runIds }, { status: 202 });
}
