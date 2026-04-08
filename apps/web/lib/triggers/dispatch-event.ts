import { createServiceClient } from "@/lib/api";

type JsonObject = Record<string, unknown>;

type TriggerRow = {
  id: string;
  program_id: string;
  config: JsonObject;
  is_active: boolean;
};

type ProgramRow = {
  id: string;
  schema: unknown;
  user_id: string;
  execution_mode: string;
  is_active: boolean;
  conflict_policy: string | null;
};

export interface DispatchEventInput {
  source: string;
  event: string;
  payload?: JsonObject;
  connection_id?: string;
  user_id?: string;
  triggered_by?: string;
}

export interface DispatchEventResult {
  matched: number;
  fired: number;
  runs: string[];
}

export async function dispatchEventTriggers(
  input: DispatchEventInput
): Promise<DispatchEventResult> {
  const db = createServiceClient();
  const payload = input.payload ?? {};

  const { data: triggersRaw, error: trigErr } = await db
    .from("triggers")
    .select("id, program_id, config, is_active")
    .eq("type", "event")
    .eq("is_active", true);

  if (trigErr) {
    throw new Error(`Failed to load event triggers: ${trigErr.message}`);
  }

  const triggers = (triggersRaw ?? []) as unknown as TriggerRow[];
  const matching = triggers.filter((trigger) => {
    const cfg = trigger.config ?? {};
    if (cfg.source !== input.source || cfg.event !== input.event) {
      return false;
    }

    const filter = cfg.filter;
    if (!filter || typeof filter !== "object" || Array.isArray(filter)) {
      return true;
    }

    const candidate = {
      ...payload,
      source: input.source,
      event: input.event,
      connection_id: input.connection_id ?? null,
      user_id: input.user_id ?? null,
      payload,
    };
    return _matchesFilter(filter, candidate);
  });

  if (matching.length === 0) {
    return { matched: 0, fired: 0, runs: [] };
  }

  let allowedProgramIds: Set<string> | null = null;
  if (input.connection_id) {
    const { data: links } = await db
      .from("program_connections")
      .select("program_id")
      .eq("connection_id", input.connection_id);

    allowedProgramIds = new Set(
      ((links ?? []) as Array<{ program_id: string }>).map((row) => row.program_id)
    );
  }

  const runtimeUrl = process.env.RUNTIME_URL ?? "http://localhost:8000";
  const runtimeSecret = process.env.RUNTIME_SECRET ?? "";
  const runIds: string[] = [];

  await Promise.all(
    matching.map(async (trigger) => {
      const { data: programRaw } = await db
        .from("programs")
        .select("id, schema, user_id, execution_mode, is_active, conflict_policy")
        .eq("id", trigger.program_id)
        .single();

      if (!programRaw) return;
      const program = programRaw as unknown as ProgramRow;
      if (!program.is_active) return;

      if (input.user_id && program.user_id !== input.user_id) return;
      if (allowedProgramIds && !allowedProgramIds.has(program.id)) return;

      const conflict = await _checkAndAcquireSlot(db, program.id, program.conflict_policy);
      if (!conflict.allowed) return;

      const triggeredBy = input.triggered_by ?? `event:${input.source}:${input.event}`;
      const triggerPayload = {
        trigger_id: trigger.id,
        source: input.source,
        event: input.event,
        payload,
        connection_id: input.connection_id ?? null,
      };

      const { data: runRaw } = await db
        .from("runs")
        .insert({
          program_id: trigger.program_id,
          triggered_by: triggeredBy,
          trigger_payload: triggerPayload,
          status: "running",
          started_at: new Date().toISOString(),
          execution_mode: program.execution_mode,
        } as never)
        .select("id")
        .single();

      if (!runRaw) return;
      const run = runRaw as unknown as { id: string };
      runIds.push(run.id);

      await db
        .from("triggers")
        .update({ last_fired_at: new Date().toISOString() } as never)
        .eq("id", trigger.id);

      // Fetch the program's linked connections to give the runtime a name→id map,
      // so connection nodes can resolve their name references to UUIDs at execution time.
      const { data: linkedConnsRaw } = await db
        .from("program_connections")
        .select("connection_id, connections(id, name)")
        .eq("program_id", trigger.program_id);

      const connectionNameToId: Record<string, string> = {};
      for (const row of (linkedConnsRaw ?? []) as Array<{
        connection_id: string;
        connections: { id: string; name: string } | null;
      }>) {
        if (row.connections) {
          connectionNameToId[row.connections.name] = row.connections.id;
        }
      }

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
          triggered_by: triggeredBy,
          trigger_payload: triggerPayload,
          connections: connectionNameToId,
        }),
      }).catch(() => {});
    })
  );

  return { matched: matching.length, fired: runIds.length, runs: runIds };
}

function _matchesFilter(filter: unknown, candidate: unknown): boolean {
  if (
    typeof filter !== "object" ||
    filter === null ||
    typeof candidate !== "object" ||
    candidate === null
  ) {
    return filter === candidate;
  }

  if (Array.isArray(filter)) {
    if (!Array.isArray(candidate) || filter.length !== candidate.length) return false;
    return filter.every((item, index) => _matchesFilter(item, candidate[index]));
  }

  const filterObj = filter as Record<string, unknown>;
  const candidateObj = candidate as Record<string, unknown>;
  return Object.entries(filterObj).every(([key, value]) =>
    _matchesFilter(value, candidateObj[key])
  );
}

async function _checkAndAcquireSlot(
  db: ReturnType<typeof createServiceClient>,
  programId: string,
  conflictPolicy: string | null
): Promise<{ allowed: boolean; reason?: string }> {
  const { data: running } = await db
    .from("runs")
    .select("id")
    .eq("program_id", programId)
    .in("status", ["running", "paused"])
    .limit(1);

  if (!running || running.length === 0) return { allowed: true };

  const policy = conflictPolicy ?? "queue";
  if (policy === "skip") {
    return { allowed: false, reason: "skip policy: another run is active" };
  }
  if (policy === "fail") {
    return { allowed: false, reason: "fail policy: another run is active" };
  }
  return { allowed: true };
}
