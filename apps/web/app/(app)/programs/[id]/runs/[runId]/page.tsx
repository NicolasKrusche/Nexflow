import { notFound } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/api";
import type { ProgramSchema, Node } from "@flowos/schema";
import { RunLogLive } from "./run-log-live";

// ─── Types ────────────────────────────────────────────────────────────────────

type RunRow = {
  id: string;
  program_id: string;
  status: string;
  triggered_by: string;
  trigger_payload: unknown;
  started_at: string | null;
  completed_at: string | null;
  error_message: string | null;
  created_at: string;
};

type NodeExecutionRow = {
  id: string;
  node_id: string;
  status: string;
  input_payload: unknown;
  output_payload: unknown;
  error_message: string | null;
  retry_count: number | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDuration(start: string | null, end: string | null): string {
  if (!start) return "—";
  const startMs = new Date(start).getTime();
  const endMs = end ? new Date(end).getTime() : Date.now();
  const diff = endMs - startMs;
  if (diff < 1000) return `${diff}ms`;
  if (diff < 60000) return `${(diff / 1000).toFixed(1)}s`;
  return `${Math.floor(diff / 60000)}m ${Math.floor((diff % 60000) / 1000)}s`;
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

// ─── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const classes: Record<string, string> = {
    pending: "bg-muted text-muted-foreground",
    running:
      "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400 animate-pulse",
    completed: "bg-green-500/15 text-green-700 dark:text-green-400",
    success: "bg-green-500/15 text-green-700 dark:text-green-400",
    failed: "bg-destructive/15 text-destructive",
    waiting_approval:
      "bg-blue-500/15 text-blue-700 dark:text-blue-400",
    skipped: "bg-muted text-muted-foreground",
  };
  const cls =
    classes[status] ?? "bg-muted text-muted-foreground";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${cls}`}
    >
      {status.replace("_", " ")}
    </span>
  );
}

// ─── Server component ─────────────────────────────────────────────────────────

export default async function RunLogPage({
  params,
}: {
  params: { id: string; runId: string };
}) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) notFound();

  const serviceClient = createServiceClient();

  // Fetch run
  const { data: runRaw, error: runError } = await serviceClient
    .from("runs")
    .select(
      "id, program_id, status, triggered_by, trigger_payload, started_at, completed_at, error_message, created_at"
    )
    .eq("id", params.runId)
    .single();

  if (runError || !runRaw) notFound();

  const run = runRaw as unknown as RunRow;

  // Verify program ownership
  const { data: program, error: progError } = await supabase
    .from("programs")
    .select("id, name, schema")
    .eq("id", run.program_id)
    .eq("user_id", user.id)
    .single();

  if (progError || !program) notFound();

  type ProgramRow = { id: string; name: string; schema: unknown };
  const prog = program as unknown as ProgramRow;
  const schema = prog.schema as unknown as ProgramSchema;
  const nodeMap: Record<string, Node> = {};
  for (const node of schema.nodes) {
    nodeMap[node.id] = node;
  }

  // Fetch initial node_executions
  const { data: execsRaw } = await serviceClient
    .from("node_executions")
    .select(
      "id, node_id, status, input_payload, output_payload, error_message, retry_count, started_at, completed_at, created_at"
    )
    .eq("run_id", params.runId)
    .order("created_at", { ascending: true });

  const initialExecs = (execsRaw ?? []) as unknown as NodeExecutionRow[];

  return (
    <div className="max-w-4xl space-y-6">
      {/* Header */}
      <div>
        <p className="text-sm text-muted-foreground mb-1">
          <a
            href={`/programs/${params.id}`}
            className="hover:underline"
          >
            {prog.name}
          </a>
          {" / "}
          <a
            href={`/programs/${params.id}/runs`}
            className="hover:underline"
          >
            Runs
          </a>
        </p>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold">Run log</h1>
          <StatusBadge status={run.status} />
        </div>
      </div>

      {/* Run metadata */}
      <div className="rounded-lg border border-border p-4 grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
        <div>
          <span className="text-muted-foreground">Run ID</span>
          <p className="font-mono text-xs mt-0.5 break-all">{run.id}</p>
        </div>
        <div>
          <span className="text-muted-foreground">Triggered by</span>
          <p className="mt-0.5">{run.triggered_by}</p>
        </div>
        <div>
          <span className="text-muted-foreground">Started</span>
          <p className="mt-0.5">{formatDateTime(run.started_at)}</p>
        </div>
        <div>
          <span className="text-muted-foreground">
            {run.completed_at ? "Completed" : "Duration so far"}
          </span>
          <p className="mt-0.5">
            {run.completed_at
              ? formatDateTime(run.completed_at)
              : "In progress…"}
          </p>
        </div>
        <div>
          <span className="text-muted-foreground">Duration</span>
          <p className="mt-0.5">
            {formatDuration(run.started_at, run.completed_at)}
          </p>
        </div>
        {run.error_message && (
          <div className="col-span-2">
            <span className="text-muted-foreground">Error</span>
            <p className="mt-0.5 text-destructive text-xs font-mono">
              {run.error_message}
            </p>
          </div>
        )}
      </div>

      {/* Live node execution timeline */}
      <RunLogLive
        runId={params.runId}
        initialExecs={initialExecs}
        nodeMap={nodeMap}
        runStatus={run.status}
      />
    </div>
  );
}
