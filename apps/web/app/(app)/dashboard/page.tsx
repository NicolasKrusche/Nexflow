import { createServerClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/api";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DeleteProgramButton } from "@/components/programs/delete-program-button";
import { GenesisPrompt } from "@/components/dashboard/genesis-prompt";

type Program = {
  id: string;
  name: string;
  description: string | null;
  execution_mode: string;
  is_active: boolean;
  schema_version: number;
  last_run_at: string | null;
  updated_at: string;
};

type RecentRun = {
  id: string;
  program_id: string;
  status: string;
  triggered_by: string;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  programs: { name: string } | null;
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function getGreeting(): string {
  const hour = new Date().getUTCHours();
  if (hour < 12) return "morning";
  if (hour < 18) return "afternoon";
  return "evening";
}

const STATUS_COLORS: Record<string, string> = {
  running: "bg-yellow-400",
  completed: "bg-green-500",
  success: "bg-green-500",
  failed: "bg-red-500",
  cancelled: "bg-muted-foreground",
  waiting_approval: "bg-blue-400",
  pending: "bg-muted-foreground",
};

export default async function DashboardPage() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [programsResult, connectionsResult] = await Promise.all([
    supabase
      .from("programs")
      .select("id, name, description, execution_mode, is_active, schema_version, last_run_at, updated_at")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false }),
    supabase
      .from("connections")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id),
  ]);

  const programs = (programsResult.data ?? []) as Program[];
  const connectionCount = connectionsResult.count ?? 0;

  const programIds = programs.map((p) => p.id);
  let recentRuns: RecentRun[] = [];

  if (programIds.length > 0) {
    const serviceClient = createServiceClient();
    const { data } = await serviceClient
      .from("runs")
      .select("id, program_id, status, triggered_by, started_at, completed_at, created_at, programs(name)")
      .in("program_id", programIds)
      .order("created_at", { ascending: false })
      .limit(8);
    recentRuns = (data ?? []) as unknown as RecentRun[];
  }

  const activePrograms = programs.filter((p) => p.is_active).length;
  const displayName = user.email?.split("@")[0] ?? "there";

  return (
    <div className="space-y-7">

      {/* ── Header ── */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black tracking-tight">
            Good {getGreeting()},{" "}
            <span
              className="text-primary"
              style={{ textShadow: "0 0 32px rgba(249,115,22,0.5), 0 0 64px rgba(249,115,22,0.2)" }}
            >
              {displayName}
            </span>
          </h1>
          {/* Inline stat pills */}
          <div className="flex items-center gap-3 mt-2">
            <span className="text-xs text-muted-foreground">
              <span className="font-semibold text-foreground tabular-nums">{programs.length}</span> programs
            </span>
            <span className="w-px h-3 bg-border" />
            <span className="text-xs text-muted-foreground">
              <span className="font-semibold text-green-500 tabular-nums">{activePrograms}</span> active
            </span>
            <span className="w-px h-3 bg-border" />
            <span className="text-xs text-muted-foreground">
              <span className="font-semibold text-foreground tabular-nums">{connectionCount}</span> connections
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button asChild variant="outline" size="sm">
            <Link href="/programs/import">Import</Link>
          </Button>
          <Button asChild size="sm">
            <Link href="/programs/new">New program</Link>
          </Button>
        </div>
      </div>

      {/* ── Genesis prompt ── */}
      <GenesisPrompt />

      {/* ── Main grid ── */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">

        {/* Programs — 3/5 */}
        <div className="lg:col-span-3 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-widest text-[11px]">Programs</h2>
            {programs.length > 0 && (
              <Link href="/programs/new" className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1">
                <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3">
                  <path d="M8.75 3.75a.75.75 0 0 0-1.5 0v3.5h-3.5a.75.75 0 0 0 0 1.5h3.5v3.5a.75.75 0 0 0 1.5 0v-3.5h3.5a.75.75 0 0 0 0-1.5h-3.5v-3.5Z" />
                </svg>
                New
              </Link>
            )}
          </div>

          {programs.length === 0 ? (
            <div className="relative rounded-xl border border-dashed border-border overflow-hidden p-12 text-center">
              <div className="absolute inset-0 bg-grid-dots opacity-20" />
              <div className="relative">
                <div className="inline-flex items-center justify-center w-10 h-10 rounded-xl border border-border bg-card text-primary mb-4">
                  <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
                    <path d="M10.75 4.75a.75.75 0 0 0-1.5 0v4.5h-4.5a.75.75 0 0 0 0 1.5h4.5v4.5a.75.75 0 0 0 1.5 0v-4.5h4.5a.75.75 0 0 0 0-1.5h-4.5v-4.5Z" />
                  </svg>
                </div>
                <p className="text-sm font-semibold mb-1">No programs yet</p>
                <p className="text-xs text-muted-foreground mb-5 max-w-xs mx-auto">Describe an automation in plain English and Nexflow designs the agent graph.</p>
                <Button asChild size="sm">
                  <Link href="/programs/new">Create first program</Link>
                </Button>
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-border overflow-hidden divide-y divide-border">
              {programs.map((p) => (
                <div key={p.id} className="group flex items-center gap-3 px-4 py-3.5 hover:bg-accent/40 transition-colors">
                  <div className={`w-0.5 h-7 rounded-full shrink-0 transition-colors ${p.is_active ? "bg-green-500/60 group-hover:bg-green-500" : "bg-border"}`} />
                  <Link href={`/programs/${p.id}`} className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{p.name}</p>
                    <p className="text-[11px] text-muted-foreground/60 mt-0.5 font-mono truncate">
                      v{p.schema_version} · {p.execution_mode}
                      {p.last_run_at && <> · {timeAgo(p.last_run_at)}</>}
                    </p>
                  </Link>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge variant={p.is_active ? "success" : "outline"} className="text-[10px] capitalize">
                      {p.is_active ? "Active" : "Inactive"}
                    </Badge>
                    <DeleteProgramButton programId={p.id} programName={p.name} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent runs — 2/5 */}
        <div className="lg:col-span-2">
          <h2 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest mb-3">Recent runs</h2>
          {recentRuns.length === 0 ? (
            <div className="rounded-xl border border-border p-8 text-center">
              <p className="text-xs text-muted-foreground">No runs yet.</p>
              <p className="text-xs text-muted-foreground/60 mt-1">Open a program and click Run.</p>
            </div>
          ) : (
            <div className="rounded-xl border border-border divide-y divide-border overflow-hidden">
              {recentRuns.map((run) => (
                <Link
                  key={run.id}
                  href={`/programs/${run.program_id}/runs/${run.id}`}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-accent/40 transition-colors"
                >
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${STATUS_COLORS[run.status] ?? "bg-muted-foreground"}`} />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium truncate">{run.programs?.name ?? "Unknown"}</p>
                    <p className="text-[11px] text-muted-foreground/60 font-mono capitalize">
                      {run.status.replace(/_/g, " ")} · {timeAgo(run.created_at)}
                    </p>
                  </div>
                  <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3 text-muted-foreground/30 shrink-0">
                    <path fillRule="evenodd" d="M6.22 3.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06-1.06L9.94 8 6.22 4.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
                  </svg>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
