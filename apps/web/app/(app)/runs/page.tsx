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

const STATUS_STYLES: Record<string, string> = {
  pending:          "bg-muted/60 text-muted-foreground",
  running:          "bg-yellow-500/12 text-yellow-400",
  completed:        "bg-green-500/12 text-green-400",
  success:          "bg-green-500/12 text-green-400",
  failed:           "bg-red-500/12 text-red-400",
  cancelled:        "bg-muted/60 text-muted-foreground",
  waiting_approval: "bg-blue-500/12 text-blue-400",
};

const STATUS_DOT: Record<string, string> = {
  running:          "bg-yellow-400",
  completed:        "bg-green-500",
  success:          "bg-green-500",
  failed:           "bg-red-500",
  waiting_approval: "bg-blue-400",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[10px] font-semibold font-mono capitalize shrink-0 ${STATUS_STYLES[status] ?? "bg-muted/60 text-muted-foreground"}`}>
      {STATUS_DOT[status] && <span className={`w-1 h-1 rounded-full shrink-0 ${STATUS_DOT[status]}`} />}
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
    { label: "All",       value: "" },
    { label: "Running",   value: "running" },
    { label: "Completed", value: "completed" },
    { label: "Failed",    value: "failed" },
    { label: "Cancelled", value: "cancelled" },
  ];

  return (
    <div className="space-y-6">

      {/* ── Header ── */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black tracking-tight">Runs</h1>
          <p className="text-sm text-muted-foreground mt-1.5">
            {runs.length > 0 ? `${runs.length} run${runs.length !== 1 ? "s" : ""}` : "No runs yet"}
          </p>
        </div>
        {/* Filter tabs */}
        <div className="inline-flex items-center gap-0.5 rounded-lg border border-border bg-card p-1 shrink-0">
          {STATUS_FILTERS.map(({ label, value }) => (
            <Link
              key={label}
              href={value ? `/runs?status=${value}` : "/runs"}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                (searchParams.status ?? "") === value
                  ? "bg-accent text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {label}
            </Link>
          ))}
        </div>
      </div>

      {runs.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card/50 p-14 text-center">
          <div className="inline-flex items-center justify-center w-10 h-10 rounded-xl border border-border bg-card text-muted-foreground/40 mb-4">
            <svg viewBox="0 0 16 16" fill="currentColor" className="w-4 h-4">
              <path d="M3 3.732a1.5 1.5 0 0 1 2.305-1.265l6.706 4.267a1.5 1.5 0 0 1 0 2.531L5.305 13.533A1.5 1.5 0 0 1 3 12.267V3.732Z" />
            </svg>
          </div>
          <p className="text-sm font-medium mb-1">
            {searchParams.status ? `No ${searchParams.status} runs` : "No runs yet"}
          </p>
          <p className="text-xs text-muted-foreground/60">Open a program and click Run to get started.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {active.length > 0 && !searchParams.status && (
            <section className="space-y-2">
              <h2 className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground/50">
                Active · {active.length}
              </h2>
              <RunList runs={active} />
            </section>
          )}
          <section className="space-y-2">
            {active.length > 0 && !searchParams.status && (
              <h2 className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground/50">
                History · {completed.length}
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
    <div className="rounded-xl border border-border bg-card divide-y divide-border/60 overflow-hidden">
      {runs.map((run) => (
        <div key={run.id} className="group flex items-center gap-3 px-4 py-3.5 hover:bg-accent/30 transition-colors">
          <Link
            href={`/programs/${run.program_id}/runs/${run.id}`}
            className="flex items-center gap-3 min-w-0 flex-1"
          >
            <StatusBadge status={run.status} />
            <div className="min-w-0">
              <p className="text-sm font-semibold truncate">
                {run.programs?.name ?? "Unknown program"}
              </p>
              <p className="text-[11px] text-muted-foreground/50 font-mono">
                {formatDateTime(run.started_at ?? run.created_at)}
                <span className="mx-1.5 opacity-40">·</span>
                {run.triggered_by}
                {run.error_message && (
                  <span className="text-red-400/80 ml-2">
                    — {run.error_message.slice(0, 60)}{run.error_message.length > 60 ? "…" : ""}
                  </span>
                )}
              </p>
            </div>
          </Link>
          <div className="flex items-center gap-3 shrink-0 ml-2">
            <span className="text-[11px] text-muted-foreground/40 font-mono tabular-nums">
              {formatDuration(run.started_at, run.completed_at)}
            </span>
            {ACTIVE_STATUSES.includes(run.status) && (
              <StopRunButton runId={run.id} />
            )}
            <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3 text-muted-foreground/20 group-hover:text-muted-foreground/50 transition-colors">
              <path fillRule="evenodd" d="M6.22 3.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06-1.06L9.94 8 6.22 4.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
            </svg>
          </div>
        </div>
      ))}
    </div>
  );
}
