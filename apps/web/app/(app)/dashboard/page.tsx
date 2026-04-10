import { createServerClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/api";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DeleteProgramButton } from "@/components/programs/delete-program-button";

// ─── Types ─────────────────────────────────────────────────────────────────────

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

// ─── Helpers ───────────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function RunStatusDot({ status }: { status: string }) {
  const colors: Record<string, string> = {
    running: "bg-yellow-400",
    completed: "bg-green-500",
    success: "bg-green-500",
    failed: "bg-destructive",
    cancelled: "bg-muted-foreground",
    waiting_approval: "bg-blue-400",
    pending: "bg-muted-foreground",
  };
  return (
    <span
      className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${colors[status] ?? "bg-muted-foreground"}`}
    />
  );
}

// ─── Stat card ─────────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  icon,
  href,
  accent = false,
}: {
  label: string;
  value: number | string;
  icon: React.ReactNode;
  href?: string;
  accent?: boolean;
}) {
  const inner = (
    <div className={`rounded-xl border p-5 flex items-start justify-between gap-4 transition-colors ${
      accent
        ? "border-primary/30 bg-primary/5 hover:bg-primary/8"
        : "border-border bg-card hover:border-border/80 hover:bg-accent/30"
    }`}>
      <div>
        <p className="text-xs text-muted-foreground mb-1">{label}</p>
        <p className="text-2xl font-bold tracking-tight">{value}</p>
      </div>
      <div className={`p-2 rounded-lg ${accent ? "bg-primary/15 text-primary" : "bg-accent text-muted-foreground"}`}>
        {icon}
      </div>
    </div>
  );
  if (href) return <Link href={href}>{inner}</Link>;
  return inner;
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default async function DashboardPage() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // ── Fetch all data in parallel ──────────────────────────────────────────────
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

  // Recent runs via service client (bypasses RLS on runs table)
  const programIds = programs.map((p) => p.id);
  let recentRuns: RecentRun[] = [];

  if (programIds.length > 0) {
    const serviceClient = createServiceClient();
    const { data } = await serviceClient
      .from("runs")
      .select("id, program_id, status, triggered_by, started_at, completed_at, created_at, programs(name)")
      .in("program_id", programIds)
      .order("created_at", { ascending: false })
      .limit(5);
    recentRuns = (data ?? []) as unknown as RecentRun[];
  }

  // ── Derived stats ───────────────────────────────────────────────────────────
  const activePrograms = programs.filter((p) => p.is_active).length;
  const totalRuns = recentRuns.length; // last 5 shown; badge is just a quick indicator
  const displayName = user.email?.split("@")[0] ?? "there";

  return (
    <div className="space-y-8">

      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Good {getGreeting()}, <span className="text-primary">{displayName}</span>
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Here&apos;s an overview of your automation workspace.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button asChild variant="outline">
            <Link href="/programs/import">Import program</Link>
          </Button>
          <Button asChild>
            <Link href="/programs/new">New program</Link>
          </Button>
        </div>
      </div>

      {/* ── Stats row ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Total programs"
          value={programs.length}
          href="/dashboard"
          accent={programs.length > 0}
          icon={
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
              <path d="M3 4a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4ZM3 10a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-6Zm11-1a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2a1 1 0 0 0 1-1v-6a1 1 0 0 0-1-1h-2Z" />
            </svg>
          }
        />
        <StatCard
          label="Active"
          value={activePrograms}
          icon={
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
              <path fillRule="evenodd" d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm3.857-9.809a.75.75 0 0 0-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 1 0-1.06 1.061l2.5 2.5a.75.75 0 0 0 1.137-.089l4-5.5Z" clipRule="evenodd" />
            </svg>
          }
        />
        <StatCard
          label="Connections"
          value={connectionCount}
          href="/connections"
          icon={
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
              <path d="M3.172 5.172a4 4 0 0 1 5.656 0L10 6.343l1.172-1.171a4 4 0 1 1 5.656 5.656L10 19l-6.828-6.172a4 4 0 0 1 0-5.656Z" />
            </svg>
          }
        />
        <StatCard
          label="Recent runs"
          value={totalRuns > 0 ? `${totalRuns}` : "0"}
          href="/runs"
          icon={
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
              <path fillRule="evenodd" d="M2 10a8 8 0 1 1 16 0 8 8 0 0 1-16 0Zm6.39-2.908a.75.75 0 0 1 .766.027l3.5 2.25a.75.75 0 0 1 0 1.262l-3.5 2.25A.75.75 0 0 1 8 12.25v-4.5a.75.75 0 0 1 .39-.658Z" clipRule="evenodd" />
            </svg>
          }
        />
      </div>

      {/* ── Main content: Programs + Recent runs side by side ── */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">

        {/* Programs list — 3/5 width */}
        <div className="lg:col-span-3 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Programs</h2>
            {programs.length > 0 && (
              <Link href="/programs/new" className="text-xs text-muted-foreground hover:text-foreground transition-colors">
                + New
              </Link>
            )}
          </div>

          {programs.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-10 text-center">
              <div className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-primary/10 text-primary mb-3">
                <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
                  <path d="M10.75 4.75a.75.75 0 0 0-1.5 0v4.5h-4.5a.75.75 0 0 0 0 1.5h4.5v4.5a.75.75 0 0 0 1.5 0v-4.5h4.5a.75.75 0 0 0 0-1.5h-4.5v-4.5Z" />
                </svg>
              </div>
              <p className="text-sm font-medium mb-1">No programs yet</p>
              <p className="text-xs text-muted-foreground mb-4">Describe an automation and Nexflow will design the agent graph for you.</p>
              <Button asChild size="sm" variant="outline">
                <Link href="/programs/new">Create first program</Link>
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              {programs.map((p) => (
                <Card key={p.id} className="hover:border-primary/30 transition-colors">
                  <CardContent className="py-3.5 px-4 flex items-center justify-between gap-4">
                    <Link href={`/programs/${p.id}`} className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{p.name}</p>
                      {p.description && (
                        <p className="text-xs text-muted-foreground mt-0.5 truncate">{p.description}</p>
                      )}
                      <p className="text-xs text-muted-foreground mt-1">
                        v{p.schema_version} · {new Date(p.updated_at).toLocaleDateString()}
                        {p.last_run_at && <> · ran {timeAgo(p.last_run_at)}</>}
                      </p>
                    </Link>
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge variant="outline" className="capitalize text-xs">
                        {p.execution_mode}
                      </Badge>
                      <Badge variant={p.is_active ? "success" : "secondary"}>
                        {p.is_active ? "Active" : "Inactive"}
                      </Badge>
                      <DeleteProgramButton programId={p.id} programName={p.name} />
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>

        {/* Right column — 2/5 width */}
        <div className="lg:col-span-2 space-y-5">

          {/* Recent runs */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold">Recent runs</h2>
              <Link href="/runs" className="text-xs text-muted-foreground hover:text-foreground transition-colors">
                View all
              </Link>
            </div>

            {recentRuns.length === 0 ? (
              <div className="rounded-xl border border-border p-6 text-center">
                <p className="text-xs text-muted-foreground">No runs yet. Open a program and click Run.</p>
              </div>
            ) : (
              <div className="rounded-xl border border-border divide-y divide-border overflow-hidden">
                {recentRuns.map((run) => (
                  <Link
                    key={run.id}
                    href={`/programs/${run.program_id}/runs/${run.id}`}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-accent transition-colors"
                  >
                    <RunStatusDot status={run.status} />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium truncate">
                        {run.programs?.name ?? "Unknown"}
                      </p>
                      <p className="text-[11px] text-muted-foreground capitalize">
                        {run.status.replace(/_/g, " ")} · {timeAgo(run.created_at)}
                      </p>
                    </div>
                    <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3 text-muted-foreground shrink-0">
                      <path fillRule="evenodd" d="M6.22 3.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06-1.06L9.94 8 6.22 4.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
                    </svg>
                  </Link>
                ))}
              </div>
            )}
          </div>

          {/* Quick links */}
          <div>
            <h2 className="text-sm font-semibold mb-3">Quick actions</h2>
            <div className="rounded-xl border border-border divide-y divide-border overflow-hidden">
              {[
                {
                  label: "New program",
                  description: "Describe an automation",
                  href: "/programs/new",
                  icon: (
                    <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5 text-primary">
                      <path d="M8.75 3.75a.75.75 0 0 0-1.5 0v3.5h-3.5a.75.75 0 0 0 0 1.5h3.5v3.5a.75.75 0 0 0 1.5 0v-3.5h3.5a.75.75 0 0 0 0-1.5h-3.5v-3.5Z" />
                    </svg>
                  ),
                },
                {
                  label: "Import program",
                  description: "Upload or paste a JSON schema",
                  href: "/programs/import",
                  icon: (
                    <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5 text-muted-foreground">
                      <path d="M8.75 2.75a.75.75 0 0 0-1.5 0v5.69L5.28 6.47a.75.75 0 0 0-1.06 1.06l3.25 3.25a.75.75 0 0 0 1.06 0l3.25-3.25a.75.75 0 0 0-1.06-1.06L8.75 8.44V2.75Z" />
                      <path d="M2.75 12a.75.75 0 0 0 0 1.5h10.5a.75.75 0 0 0 0-1.5H2.75Z" />
                    </svg>
                  ),
                },
                {
                  label: "Add connection",
                  description: "Connect Gmail, Slack & more",
                  href: "/connections",
                  icon: (
                    <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5 text-muted-foreground">
                      <path d="M4.5 7a.75.75 0 0 0 0 1.5h5.69L8.22 10.47a.75.75 0 1 0 1.06 1.06l3-3a.75.75 0 0 0 0-1.06l-3-3a.75.75 0 0 0-1.06 1.06L10.19 7H4.5Z" />
                    </svg>
                  ),
                },
                {
                  label: "API keys",
                  description: "Manage your model API keys",
                  href: "/api-keys",
                  icon: (
                    <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5 text-muted-foreground">
                      <path fillRule="evenodd" d="M8 1a3.5 3.5 0 0 1 3.5 3.5V5h.75A1.75 1.75 0 0 1 14 6.75v6.5A1.75 1.75 0 0 1 12.25 15h-8.5A1.75 1.75 0 0 1 2 13.25v-6.5A1.75 1.75 0 0 1 3.75 5h.75V4.5A3.5 3.5 0 0 1 8 1Zm0 1.5a2 2 0 0 0-2 2V5h4V4.5a2 2 0 0 0-2-2Zm0 6.25a.75.75 0 0 1 .75.75v1.5a.75.75 0 0 1-1.5 0v-1.5a.75.75 0 0 1 .75-.75Z" clipRule="evenodd" />
                    </svg>
                  ),
                },
              ].map(({ label, description, href, icon }) => (
                <Link
                  key={href}
                  href={href}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-accent transition-colors"
                >
                  <div className="w-6 h-6 rounded-md bg-accent flex items-center justify-center shrink-0">
                    {icon}
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-medium">{label}</p>
                    <p className="text-[11px] text-muted-foreground">{description}</p>
                  </div>
                  <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3 text-muted-foreground shrink-0 ml-auto">
                    <path fillRule="evenodd" d="M6.22 3.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06-1.06L9.94 8 6.22 4.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
                  </svg>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function getGreeting(): string {
  const hour = new Date().getUTCHours();
  if (hour < 12) return "morning";
  if (hour < 18) return "afternoon";
  return "evening";
}
