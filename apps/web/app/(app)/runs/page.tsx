import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/api";
import { StopRunButton } from "@/app/(app)/programs/[id]/runs/[runId]/stop-button";

// ─── Types ────────────────────────────────────────────────────────────────────

type RunRow = {
  id: string;
  program_id: string;
  status: string;
  triggered_by: string;
  started_at: string | null;
  completed_at: string | null;
  error_message: string | null;
  created_at: string;
  programs: { name: string } | null;
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

function StatusBadge({ status }: { status: string }) {
  const classes: Record<string, string> = {
    pending: "bg-muted text-muted-foreground",
    running: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400",
    completed: "bg-green-500/15 text-green-700 dark:text-green-400",
    success: "bg-green-500/15 text-green-700 dark:text-green-400",
    failed: "bg-destructive/15 text-destructive",
    cancelled: "bg-muted text-muted-foreground",
    waiting_approval: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  };
  const cls = classes[status] ?? "bg-muted text-muted-foreground";
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${cls}`}>
      {status.replace(/_/g, " ")}
    </span>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function RunsPage({
  searchParams,
}: {
  searchParams: { status?: string };
}) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Get all program IDs owned by this user (RLS-safe join via service client)
  const { data: programsRaw } = await supabase
    .from("programs")
    .select("id")
    .eq("user_id", user.id);

  const programIds = (programsRaw ?? []).map((p: { id: string }) => p.id);

  const serviceClient = createServiceClient();

  let query = serviceClient
    .from("runs")
    .select("id, program_id, status, triggered_by, started_at, completed_at, error_message, created_at, programs(name)")
    .in("program_id", programIds.length > 0 ? programIds : ["__none__"])
    .order("created_at", { ascending: false })
    .limit(100);

  if (searchParams.status) {
    query = query.eq("status", searchParams.status);
  }

  const { data: runsRaw } = await query;
  const runs = (runsRaw ?? []) as unknown as RunRow[];

  const activeStatuses = ["running", "waiting_approval"];
  const active = runs.filter((r) => activeStatuses.includes(r.status));
  const completed = runs.filter((r) => !activeStatuses.includes(r.status));

  const STATUS_FILTERS = [
    { label: "All", value: "" },
    { label: "Running", value: "running" },
    { label: "Completed", value: "completed" },
    { label: "Failed", value: "failed" },
    { label: "Cancelled", value: "cancelled" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Runs</h1>
        <div className="flex items-center gap-1">
          {STATUS_FILTERS.map(({ label, value }) => (
            <Link
              key={label}
              href={value ? `/runs?status=${value}` : "/runs"}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                (searchParams.status ?? "") === value
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              }`}
            >
              {label}
            </Link>
          ))}
        </div>
      </div>

      {runs.length === 0 ? (
        <div className="rounded-lg border border-border p-12 text-center">
          <p className="text-sm text-muted-foreground">
            {searchParams.status ? `No ${searchParams.status} runs.` : "No runs yet. Open a program and click Run."}
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {active.length > 0 && !searchParams.status && (
            <section className="space-y-2">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-1">
                Active
              </h2>
              <RunList runs={active} />
            </section>
          )}

          <section className="space-y-2">
            {active.length > 0 && !searchParams.status && (
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-1">
                History
              </h2>
            )}
            <RunList runs={searchParams.status ? runs : completed} />
          </section>
        </div>
      )}
    </div>
  );
}

const ACTIVE_STATUSES = ["running", "waiting_approval", "pending"];

function RunList({ runs }: { runs: RunRow[] }) {
  return (
    <div className="rounded-lg border border-border divide-y divide-border overflow-hidden">
      {runs.map((run) => (
        <div key={run.id} className="flex items-center justify-between px-4 py-3 hover:bg-accent transition-colors">
          <Link
            href={`/programs/${run.program_id}/runs/${run.id}`}
            className="flex items-center gap-3 min-w-0 flex-1"
          >
            <StatusBadge status={run.status} />
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">
                {run.programs?.name ?? "Unknown program"}
              </p>
              <p className="text-xs text-muted-foreground">
                {formatDateTime(run.started_at ?? run.created_at)}
                <span className="mx-1.5">·</span>
                {run.triggered_by}
                {run.error_message && (
                  <span className="text-destructive ml-2">
                    — {run.error_message.slice(0, 60)}
                    {run.error_message.length > 60 ? "…" : ""}
                  </span>
                )}
              </p>
            </div>
          </Link>
          <div className="flex items-center gap-3 shrink-0 ml-4">
            <span className="text-xs text-muted-foreground">
              {formatDuration(run.started_at, run.completed_at)}
            </span>
            {ACTIVE_STATUSES.includes(run.status) && (
              <StopRunButton runId={run.id} />
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
