import { Suspense } from "react";
import { LocalDateTime } from "@/components/ui/local-date-time";
import { createServerClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { notFound } from "next/navigation";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  Bot,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Circle,
  Clock3,
  Code2,
  Copy,
  ExternalLink,
  FileJson,
  FileText,
  History,
  BarChart3,
  Loader2,
  Network,
  RefreshCw,
  Settings,
  Sparkles,
  UserRound,
  Zap,
} from "lucide-react";
import { ProgramSchemaZ, type ProgramSchema } from "@flowos/schema";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RunPanel } from "./run-panel";
import { ExecutionControls } from "./execution-controls";
import { PublishPanel } from "./publish-panel";
import { SharePanel } from "./share-panel";
import { DeleteProgramButton } from "@/components/programs/delete-program-button";
import { ProgramTour } from "@/components/programs/program-tour";
import { MiniGraphCanvas } from "@/components/programs/program-mini-graph";
import type { Json } from "@flowos/db";
import { createServiceClient } from "@/lib/api";
import { canEdit, canView, getProgramAccess } from "@/lib/workspaces";
import { loadWorkflowProviderContext, loadWorkspaceComplianceSettings } from "@/lib/compliance/server";
import {
  buildDataFlowPreview,
  validateWorkflowCompliance,
  type ComplianceCheck,
  type ComplianceCheckStatus,
  type DataFlowPreviewItem,
} from "@/lib/compliance/workflow";

type SchemaNode = {
  id: string;
  label: string;
  description: string;
  type: string;
  config?: { trigger_type?: string } | null;
};

function parseSchema(raw: Json) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { nodes: [], edges: [], triggers: [], genesisModel: null, rawNodes: [], rawEdges: [] };
  }
  const schema = raw as Record<string, Json>;
  const rawNodes = Array.isArray(schema.nodes) ? (schema.nodes as unknown[]) : [];
  const rawEdges = Array.isArray(schema.edges) ? (schema.edges as unknown[]) : [];
  const nodes = rawNodes as unknown as SchemaNode[];
  const edges = rawEdges;
  const triggers = Array.isArray(schema.triggers) ? schema.triggers : [];
  const metadata = schema.metadata && typeof schema.metadata === "object" && !Array.isArray(schema.metadata)
    ? (schema.metadata as Record<string, Json>)
    : null;
  const genesisModel = metadata && typeof metadata.genesis_model === "string" ? metadata.genesis_model : null;
  return { nodes, edges, triggers, genesisModel, rawNodes, rawEdges };
}

function isAiGenerated(genesisModel: string | null): boolean {
  if (!genesisModel) return false;
  return genesisModel !== "manual" && genesisModel !== "template";
}

// NOTE: timestamps are UTC instants and this is a server component, so they
// must be formatted client-side in the viewer's zone — see <LocalDateTime>.

function shortProgramId(id: string) {
  return `prg_${id.slice(0, 4)}.${id.slice(-4)}`;
}

function NodeGlyph({ type }: { type: string }) {
  const normalized = type.toLowerCase();
  if (normalized.includes("trigger")) return <Zap className="h-4 w-4" />;
  if (normalized.includes("agent")) return <Bot className="h-4 w-4" />;
  if (normalized.includes("connection")) return <Network className="h-4 w-4" />;
  return <Circle className="h-4 w-4" />;
}

function complianceStatusClass(status: ComplianceCheckStatus) {
  if (status === "passed") return "border-emerald-300 bg-emerald-500/10 text-emerald-700 dark:border-emerald-500/40 dark:text-emerald-300";
  if (status === "warning") return "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200";
  if (status === "needs_reviewer") return "border-blue-300 bg-blue-500/10 text-blue-700 dark:border-blue-500/40 dark:text-blue-300";
  return "border-red-300 bg-red-500/10 text-red-700 dark:border-red-500/40 dark:text-red-300";
}

function ComplianceStatusIcon({ status }: { status: ComplianceCheckStatus }) {
  if (status === "passed") return <CheckCircle2 className="h-4 w-4" />;
  return <AlertTriangle className="h-4 w-4" />;
}

function statusLabel(status: ComplianceCheckStatus) {
  if (status === "needs_reviewer") return "Needs reviewer";
  return status[0].toUpperCase() + status.slice(1);
}

function DataFlowLabels({ item }: { item: DataFlowPreviewItem }) {
  const labels = item.labels.slice(0, 5);
  return (
    <div className="flex flex-wrap gap-1.5">
      {labels.map((label) => (
        <Badge key={label} variant="outline" className="rounded-md px-2 py-0.5 text-[11px]">
          {label}
        </Badge>
      ))}
    </div>
  );
}

export default async function ProgramPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return redirect("/login");

  const access = await getProgramAccess(id, user.id);
  if (!canView(access)) return notFound();
  const userCanEdit = canEdit(access);
  const serviceClient = createServiceClient();

  const { data, error } = await serviceClient
    .from("programs")
    .select("id, user_id, name, description, execution_mode, conflict_policy, is_active, schema, schema_version, last_run_at, created_at, updated_at, is_public, tags, fork_count, published_at, public_author_name, visibility, workspace_id, ai_use_case_category, ai_act_risk_level, customer_role, human_oversight_required, transparency_notice_required, high_risk_documentation_required, prohibited_reason, reviewer, reviewed_at, ai_act_notes, legal_review_override")
    .eq("id", id)
    .single();

  if (error || !data) return notFound();

  type ProgramRow = {
    id: string;
    user_id: string;
    name: string;
    description: string | null;
    execution_mode: string;
    conflict_policy: string;
    is_active: boolean;
    schema: Json;
    schema_version: number | null;
    last_run_at: string | null;
    created_at: string | null;
    updated_at: string | null;
    is_public: boolean;
    tags: string[];
    fork_count: number;
    published_at: string | null;
    public_author_name: string | null;
    visibility: string;
    workspace_id: string;
    ai_use_case_category?: string | null;
    ai_act_risk_level?: "prohibited" | "high_risk" | "transparency" | "gpai_related" | "limited_or_minimal" | "unknown" | null;
    customer_role?: "provider" | "deployer" | "distributor" | "importer" | "product_manufacturer" | "unknown" | null;
    human_oversight_required?: boolean | null;
    transparency_notice_required?: boolean | null;
    high_risk_documentation_required?: boolean | null;
    prohibited_reason?: string | null;
    reviewer?: string | null;
    reviewed_at?: string | null;
    ai_act_notes?: string | null;
    legal_review_override?: boolean | null;
  };

  const program = data as ProgramRow;
  const { nodes, edges, genesisModel, rawNodes, rawEdges } = parseSchema(program.schema);
  const aiGenerated = isAiGenerated(genesisModel);

  const [
    linkedConnsResult,
    completedRunsResult,
    failedRunsResult,
    runningRunsResult,
    creatorResult,
    triggersResult,
  ] = await Promise.all([
    serviceClient.from("program_connections").select("connection_id").eq("program_id", id),
    serviceClient.from("runs").select("id", { count: "exact", head: true }).eq("program_id", id).eq("status", "completed"),
    serviceClient.from("runs").select("id", { count: "exact", head: true }).eq("program_id", id).eq("status", "failed"),
    serviceClient.from("runs").select("id", { count: "exact", head: true }).eq("program_id", id).in("status", ["running", "waiting_approval"]),
    serviceClient.from("profiles").select("display_name").eq("id", program.user_id).maybeSingle(),
    serviceClient.from("triggers").select("type, is_active, next_run_at").eq("program_id", id).neq("type", "manual"),
  ]);

  const isRunning = (runningRunsResult.count ?? 0) > 0;

  const connectionIds = (linkedConnsResult.data ?? []).map((r: { connection_id: string }) => r.connection_id);

  // Surface schedule state next to the Active/Inactive badge: a daily cron
  // program looks "idle" almost all the time, so the badge alone can't tell
  // a user whether it's actually on autopilot.
  type ProgramTriggerRow = { type: string; is_active: boolean; next_run_at: string | null };
  const programTriggers = (triggersResult.data ?? []) as ProgramTriggerRow[];
  const nextCronRun = programTriggers
    .filter((trigger) => trigger.type === "cron" && trigger.is_active && trigger.next_run_at)
    .sort((a, b) => (a.next_run_at as string).localeCompare(b.next_run_at as string))[0]?.next_run_at ?? null;
  const hasPausedCronOnly = !nextCronRun && programTriggers.some((trigger) => trigger.type === "cron" && !trigger.is_active);
  const hasOtherActiveTrigger = !nextCronRun && programTriggers.some((trigger) => trigger.type !== "cron" && trigger.is_active);
  // programs.is_active is not a real activation flag — nothing in the app ever
  // sets it true, and it's no longer checked before firing triggers (triggers.is_active
  // is the source of truth). Derive the displayed Active/Inactive state from that instead.
  const hasActiveTrigger = programTriggers.some((trigger) => trigger.is_active);

  let conflictingProgramCount = 0;
  if (connectionIds.length > 0) {
    const { data: sharedLinks } = await serviceClient
      .from("program_connections")
      .select("program_id")
      .in("connection_id", connectionIds)
      .neq("program_id", id);
    conflictingProgramCount = new Set((sharedLinks ?? []).map((r: { program_id: string }) => r.program_id)).size;
  }

  const completedRuns = completedRunsResult.count ?? 0;
  const failedRuns = failedRunsResult.count ?? 0;
  const creatorName = (creatorResult.data as { display_name?: string | null } | null)?.display_name ?? "Unknown";
  const parsedComplianceSchema = ProgramSchemaZ.safeParse(program.schema);
  let complianceChecks: ComplianceCheck[] = [
    {
      id: "schema-validation",
      label: "Schema validation",
      status: "blocked",
      message: "Workflow schema could not be validated, so compliance checks cannot run.",
    },
  ];
  let dataFlowPreview: DataFlowPreviewItem[] = [];
  let workspaceComplianceMode = "standard";
  if (parsedComplianceSchema.success) {
    const complianceSchema = parsedComplianceSchema.data as unknown as ProgramSchema;
    const workspaceCompliance = await loadWorkspaceComplianceSettings(program.workspace_id, serviceClient as never);
    const providerContext = await loadWorkflowProviderContext(program.id, program.workspace_id, serviceClient as never);
    workspaceComplianceMode = workspaceCompliance.compliance_mode;
    complianceChecks = validateWorkflowCompliance(
      complianceSchema,
      workspaceCompliance,
      providerContext,
      program
    );
    dataFlowPreview = buildDataFlowPreview(
      complianceSchema,
      workspaceCompliance,
      providerContext
    );
  }

  return (
    <div className="w-full space-y-4 pb-10">
      <div className="space-y-5 border-b border-border pb-6">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Link href="/dashboard" className="inline-flex items-center gap-1 hover:text-foreground">
            <ArrowLeft className="h-4 w-4" />
            Programs
          </Link>
          <span>/</span>
          <span className="font-medium text-foreground">{program.name}</span>
        </div>

        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`h-2.5 w-2.5 rounded-full ${hasActiveTrigger ? "bg-emerald-500" : "bg-muted-foreground/40"}`} />
              <h1 className="truncate text-3xl font-semibold tracking-normal">{program.name}</h1>
              <Badge variant="secondary">{hasActiveTrigger ? "Active" : "Inactive"}</Badge>
              {isRunning && (
                <Badge variant="outline" className="border-primary/30 bg-primary/10 text-primary">
                  <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                  Running
                </Badge>
              )}
              {nextCronRun && (
                <Badge
                  variant="outline"
                  className="border-primary/30 bg-primary/10 text-primary"
                >
                  <Clock3 className="mr-1 h-3 w-3" />
                  Next run&nbsp;<LocalDateTime value={nextCronRun} fallback="scheduled" withTitle />
                </Badge>
              )}
              {hasOtherActiveTrigger && (
                <Badge variant="outline" className="border-primary/30 bg-primary/10 text-primary">
                  <Clock3 className="mr-1 h-3 w-3" />
                  Runs automatically
                </Badge>
              )}
              {hasPausedCronOnly && hasActiveTrigger && (
                <Badge
                  variant="outline"
                  title="This program is active, but its schedule is paused — it will not fire on its own until you resume the trigger."
                  className="border-amber-400/40 bg-amber-500/10 text-amber-700 dark:border-amber-500/40 dark:text-amber-300"
                >
                  Schedule paused
                </Badge>
              )}
              {aiGenerated && (
                <Badge variant="outline" className="border-primary/30 bg-primary/10 text-primary">
                  <Sparkles className="mr-1 h-3 w-3" />
                  AI-generated
                </Badge>
              )}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <span>{program.description || "blank program"}</span>
              <span>·</span>
              <span>workflow</span>
              <span>·</span>
              <span>v{program.schema_version ?? 1} schema</span>
              <span>·</span>
              <span>created <LocalDateTime value={program.created_at} /></span>
              <span>·</span>
              <span className="font-mono">{shortProgramId(program.id)}</span>
            </div>
          </div>

          <div data-tour="program-actions" className="flex shrink-0 flex-wrap items-center gap-2">
            <Button asChild variant="outline" size="sm" className="h-9">
              <Link href={`/programs/${id}/runs`}>
                <RefreshCw className="h-4 w-4" />
                Runs
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm" className="h-9">
              <Link href={`/programs/${id}/triggers`}>
                <Zap className="h-4 w-4" />
                Triggers
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm" className="h-9">
              <Link href={`/programs/${id}/analytics`}>
                <BarChart3 className="h-4 w-4" />
                Analytics
              </Link>
            </Button>
            {userCanEdit && (
              <>
                <Button asChild variant="outline" size="sm" className="h-9">
                  <Link href={`/programs/${program.id}/settings`}>
                    <Settings className="h-4 w-4" />
                    Settings
                  </Link>
                </Button>
                <DeleteProgramButton programId={program.id} programName={program.name} />
                <Button asChild size="sm" className="h-9 px-4">
                  <Link href={`/programs/${program.id}/editor`} data-tour="program-open-editor">
                    <ExternalLink className="h-4 w-4" />
                    Open editor
                  </Link>
                </Button>
              </>
            )}
          </div>
        </div>
      </div>

      {aiGenerated && !hasActiveTrigger && (
        <div className="flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/10 px-4 py-3 text-sm text-foreground">
          <Sparkles className="h-4 w-4 shrink-0 text-primary" />
          <p className="min-w-0 flex-1">
            <span className="font-semibold">Review this AI-generated workflow before activation.</span>{" "}
            <span className="text-muted-foreground">Output can be incorrect or incomplete.</span>{" "}
            {genesisModel && genesisModel !== "manual" && genesisModel !== "template" && (
              <span className="text-muted-foreground">Model <span className="rounded bg-background/70 px-1 font-mono text-xs">{genesisModel}</span></span>
            )}
          </p>
          <Link href={`/programs/${program.id}/editor`} className="text-sm font-medium text-primary">{"Review ->"}</Link>
        </div>
      )}

      {conflictingProgramCount > 0 && (
        <div className="flex items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
          <p className="min-w-0 flex-1">
            <span className="font-semibold">{conflictingProgramCount} other programs share connections with this workflow.</span>{" "}
            <span className="text-muted-foreground">Concurrent run policy: </span>
            <span className="rounded bg-background/70 px-1 font-mono text-xs">{program.conflict_policy}</span>
          </p>
          <Link href={`/programs/${id}/conflicts`} className="text-sm font-medium text-primary">{"View conflicts ->"}</Link>
        </div>
      )}

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <main className="space-y-4">
          <section data-tour="program-topology" className="overflow-hidden rounded-lg border glass-card shadow-sm">
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-semibold">Workflow topology</h2>
                  <Badge variant="outline" className="rounded-md">{nodes.length} {nodes.length === 1 ? "node" : "nodes"}</Badge>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">Nodes in execution order with their current role in the graph.</p>
              </div>
              <div className="flex items-center gap-2">
                {userCanEdit && (
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/programs/${program.id}/editor`}>
                      <ExternalLink className="h-4 w-4" />
                      Open editor
                    </Link>
                  </Button>
                )}
              </div>
            </div>

            {/* Inline read-only graph */}
            <div className="border-b border-border" style={{ height: 300 }}>
              <MiniGraphCanvas rawNodes={rawNodes} rawEdges={rawEdges} />
            </div>

            {/* Node list */}
            <div>
              {nodes.length === 0 ? (
                <div className="p-8 text-center text-sm text-muted-foreground">No nodes yet.</div>
              ) : (
                nodes.map((node, i) => (
                  <div key={`${node.id}-${i}`} className="flex items-center gap-4 border-b border-border px-6 py-4 last:border-b-0">
                    <span className="w-5 shrink-0 text-right text-xs text-muted-foreground">#{i + 1}</span>
                    <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-primary/30 bg-primary/10 text-primary">
                      <NodeGlyph type={node.type} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold">{node.label}</p>
                      <p className="text-sm text-muted-foreground">{node.description || "No description."}</p>
                    </div>
                    <span className="hidden font-mono text-xs text-muted-foreground sm:block">{node.type === "trigger" ? `trigger.${node.config?.trigger_type ?? "manual"}` : node.type}</span>
                    <Badge variant="outline" className="border-primary/30 bg-primary/10 text-primary">{node.type}</Badge>
                  </div>
                ))
              )}
            </div>
          </section>

          {userCanEdit && (
            <div data-tour="program-execution">
              <ExecutionControls
                programId={program.id}
                executionMode={program.execution_mode ?? "supervised"}
                conflictPolicy={program.conflict_policy ?? "queue"}
              />
            </div>
          )}

          <div data-tour="program-run">
            <RunPanel programId={program.id} />
          </div>

          <section className="overflow-hidden rounded-lg border glass-card shadow-sm">
            <div className="flex flex-col gap-3 border-b border-border px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-semibold">Publish checklist</h2>
                  <Badge variant="outline" className="rounded-md">
                    {workspaceComplianceMode === "eu_only" ? "EU-only mode" : "Standard mode"}
                  </Badge>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  GDPR transfer, DPA, AI Act, approval, logging, secrets, and model-provider checks.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button asChild variant="outline" size="sm" className="h-9">
                  <Link href={`/api/programs/${program.id}/compliance/export?format=json`} target="_blank">
                    <FileJson className="h-4 w-4" />
                    JSON export
                  </Link>
                </Button>
                <Button asChild variant="outline" size="sm" className="h-9">
                  <Link href={`/api/programs/${program.id}/compliance/export?format=html`} target="_blank">
                    <FileText className="h-4 w-4" />
                    HTML report
                  </Link>
                </Button>
                <Button asChild variant="outline" size="sm" className="h-9">
                  <Link href={`/api/programs/${program.id}/compliance/export?format=technical-docx`} target="_blank">
                    <FileText className="h-4 w-4" />
                    Technical DOCX
                  </Link>
                </Button>
                <Button asChild variant="outline" size="sm" className="h-9">
                  <Link href={`/governance/dpia/${program.id}`}>
                    <FileText className="h-4 w-4" />
                    DPIA drafts
                  </Link>
                </Button>
              </div>
            </div>

            <div className="divide-y divide-border">
              {complianceChecks.map((check) => (
                <div key={check.id} className="flex items-start gap-3 px-5 py-4">
                  <span className={`mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border ${complianceStatusClass(check.status)}`}>
                    <ComplianceStatusIcon status={check.status} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold">{check.label}</p>
                      <Badge variant="outline" className={`rounded-md ${complianceStatusClass(check.status)}`}>
                        {statusLabel(check.status)}
                      </Badge>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">{check.message}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="overflow-hidden rounded-lg border glass-card shadow-sm">
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <div>
                <h2 className="text-sm font-semibold">Data-flow preview</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Trigger, node, provider, region, data categories, transfer basis, retention, and approval visibility.
                </p>
              </div>
            </div>
            {dataFlowPreview.length === 0 ? (
              <div className="p-6 text-sm text-muted-foreground">
                No data-flow preview is available until the workflow schema validates.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[920px] text-left text-sm">
                  <thead className="border-b border-border bg-muted/50 text-xs uppercase tracking-normal text-muted-foreground">
                    <tr>
                      <th className="px-5 py-3 font-medium">Node/action</th>
                      <th className="px-5 py-3 font-medium">Provider</th>
                      <th className="px-5 py-3 font-medium">Region</th>
                      <th className="px-5 py-3 font-medium">Data</th>
                      <th className="px-5 py-3 font-medium">Transfer</th>
                      <th className="px-5 py-3 font-medium">Controls</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {dataFlowPreview.map((item) => (
                      <tr key={item.node_id}>
                        <td className="px-5 py-4 align-top">
                          <p className="font-medium">{item.node_label}</p>
                          <p className="mt-1 text-xs text-muted-foreground">{item.action}</p>
                        </td>
                        <td className="px-5 py-4 align-top">
                          <p className="font-medium">{item.provider.name}</p>
                          <p className="mt-1 text-xs text-muted-foreground">{item.provider.category}</p>
                        </td>
                        <td className="px-5 py-4 align-top text-xs text-muted-foreground">{item.region}</td>
                        <td className="px-5 py-4 align-top">
                          <p className="text-xs text-muted-foreground">{item.data_categories.join(", ")}</p>
                          <p className="mt-1 text-xs">
                            Personal data: {item.personal_data_may_be_processed ? "may be processed" : "not expected"}
                          </p>
                        </td>
                        <td className="px-5 py-4 align-top">
                          <p className={item.leaves_eea ? "text-xs font-medium text-amber-700 dark:text-amber-300" : "text-xs font-medium text-emerald-700 dark:text-emerald-300"}>
                            {item.leaves_eea ? "Possible third-country transfer" : "No EEA exit indicated"}
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">{item.transfer_basis}</p>
                        </td>
                        <td className="px-5 py-4 align-top">
                          <DataFlowLabels item={item} />
                          <p className="mt-2 text-xs text-muted-foreground">
                            Approval: {item.human_approval_gate ? "yes" : "no"} · Model: {item.model_name ?? "no"}
                          </p>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {userCanEdit && (
            <PublishPanel
              programId={program.id}
              initialState={{
                is_public: program.is_public ?? false,
                tags: program.tags ?? [],
                fork_count: program.fork_count ?? 0,
                published_at: program.published_at ?? null,
                public_author_name: program.public_author_name ?? null,
              }}
              hasSuccessfulRun={completedRuns > 0}
            />
          )}
        </main>

        <aside className="space-y-4 lg:sticky lg:top-6">
          <section className="overflow-hidden rounded-lg border glass-card shadow-sm">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <h2 className="text-sm font-semibold">Operations</h2>
              <span className="text-xs text-muted-foreground">last 7d</span>
            </div>
            <div className="divide-y divide-border">
              {[
                { label: "Last run", value: <LocalDateTime value={program.last_run_at} />, icon: Clock3 },
                { label: "Updated", value: <LocalDateTime value={program.updated_at} />, icon: CalendarDays },
                { label: "Completed runs", value: completedRuns, icon: CheckCircle2 },
                { label: "Failed runs", value: failedRuns, icon: AlertTriangle },
                { label: "Created by", value: creatorName, icon: UserRound },
                { label: "Program ID", value: shortProgramId(program.id), icon: Copy, mono: true },
              ].map(({ label, value, icon: Icon, mono }) => (
                <div key={label} className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
                  <span className="inline-flex items-center gap-2 text-muted-foreground">
                    <Icon className="h-4 w-4" />
                    {label}
                  </span>
                  <span className={mono ? "font-mono text-xs" : "font-medium"}>{value}</span>
                </div>
              ))}
            </div>
            <div className="divide-y divide-border border-t border-border">
              {[
                { label: "View run history", href: `/programs/${id}/runs`, icon: History },
                { label: "Manage triggers", href: `/programs/${id}/triggers`, icon: Zap },
                { label: "Conflict settings", href: `/programs/${id}/conflicts`, icon: AlertTriangle },
              ].map(({ label, href, icon: Icon }) => (
                <Link key={label} href={href} className="flex items-center justify-between px-4 py-3 text-sm font-medium hover:bg-muted/50">
                  <span className="inline-flex items-center gap-3">
                    <Icon className="h-4 w-4 text-muted-foreground" />
                    {label}
                  </span>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </Link>
              ))}
            </div>
          </section>

          <SharePanel programId={program.id} />

          <details className="rounded-lg border glass-card shadow-sm">
            <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-4">
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                <Code2 className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold">Raw schema</span>
                <span className="block text-xs text-muted-foreground">View JSON · download · copy</span>
              </span>
              <ExternalLink className="h-4 w-4 text-muted-foreground" />
            </summary>
            <pre className="max-h-[420px] overflow-auto border-t border-border bg-muted p-4 text-xs leading-5">
              {JSON.stringify(program.schema, null, 2)}
            </pre>
          </details>

          <Button variant="outline" asChild className="w-full justify-start">
            <Link href="/dashboard">
              <FileJson className="h-4 w-4" />
              Back to dashboard
            </Link>
          </Button>
        </aside>
      </div>

      <Suspense>
        <ProgramTour />
      </Suspense>
    </div>
  );
}
