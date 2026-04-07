import Link from "next/link";
import { notFound } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/api";

// ─── Types ────────────────────────────────────────────────────────────────────

type RunRow = {
  id: string;
  status: string;
  triggered_by: string;
  started_at: string | null;
  completed_at: string | null;
  error_message: string | null;
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
    running: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400",
    completed: "bg-green-500/15 text-green-700 dark:text-green-400",
    success: "bg-green-500/15 text-green-700 dark:text-green-400",
    failed: "bg-destructive/15 text-destructive",
    waiting_approval: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  };
  const cls = classes[status] ?? "bg-muted text-muted-foreground";
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${cls}`}>
      {status.replace("_", " ")}
    </span>
  );
}

// ─── Server component ─────────────────────────────────────────────────────────

export default async function RunsPage({
  params,
}: {
  params: { id: string };
}) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) notFound();

  // Verify program ownership
  const { data: program, error: progError } = await supabase
    .from("programs")
    .select("id, name")
    .eq("id", params.id)
    .eq("user_id", user.id)
    .single();

  if (progError || !program) notFound();

  const prog = program as unknown as { id: string; name: string };
  const serviceClient = createServiceClient();

  const { data: runsRaw } = await serviceClient
    .from("runs")
    .select(
      "id, status, triggered_by, started_at, completed_at, error_message, created_at"
    )
    .eq("program_id", params.id)
    .order("created_at", { ascending: false })
    .limit(50);

  const runs = (runsRaw ?? []) as unknown as RunRow[];

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <p className="text-sm text-muted-foreground mb-1">
          <Link href={`/programs/${params.id}`} className="hover:underline">
            {prog.name}
          </Link>
        </p>
        <h1 className="text-2xl font-semibold">Runs</h1>
      </div>

      {runs.length === 0 ? (
        <div className="rounded-lg border border-border p-8 text-center">
          <p className="text-sm text-muted-foreground">
            No runs yet. Use the Run panel on the program page to start one.
          </p>
        </div>
      ) : (
        <div className="rounded-lg border border-border divide-y divide-border overflow-hidden">
          {runs.map((run) => (
            <Link
              key={run.id}
              href={`/programs/${params.id}/runs/${run.id}`}
              className="flex items-center justify-between px-4 py-3 hover:bg-accent transition-colors"
            >
              <div className="flex items-center gap-3">
                <StatusBadge status={run.status} />
                <div>
                  <p className="text-sm font-medium">
                    {formatDateTime(run.started_at ?? run.created_at)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {run.triggered_by}
                    {run.error_message && (
                      <span className="text-destructive ml-2">
                        — {run.error_message.slice(0, 60)}
                        {run.error_message.length > 60 ? "…" : ""}
                      </span>
                    )}
                  </p>
                </div>
              </div>
              <div className="text-xs text-muted-foreground shrink-0">
                {formatDuration(run.started_at, run.completed_at)}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
