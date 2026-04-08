import { createServerClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RunPanel } from "./run-panel";
import { ExecutionControls } from "./execution-controls";
import { DeleteProgramButton } from "@/components/programs/delete-program-button";
import type { Json } from "@flowos/db";
import { createServiceClient } from "@/lib/api";

type SchemaNode = { id: string; label: string; description: string; type: string };

function parseSchema(raw: Json) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { nodes: [], edges: [], triggers: [] };
  const schema = raw as Record<string, Json>;
  const nodes = Array.isArray(schema.nodes) ? (schema.nodes as unknown as SchemaNode[]) : [];
  const edges = Array.isArray(schema.edges) ? schema.edges : [];
  const triggers = Array.isArray(schema.triggers) ? schema.triggers : [];
  return { nodes, edges, triggers };
}

export default async function ProgramPage({ params }: { params: { id: string } }) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return redirect("/login");

  const { data, error } = await supabase
    .from("programs")
    .select("id, name, description, execution_mode, conflict_policy, is_active, schema, schema_version, last_run_at, updated_at")
    .eq("id", params.id)
    .eq("user_id", user.id)
    .single();

  if (error || !data) return notFound();

  type ProgramRow = typeof data & { schema: Json; conflict_policy: string };
  const program = data as ProgramRow;
  const { nodes, edges, triggers } = parseSchema(program.schema);

  // Fetch active trigger count from DB
  const serviceClient = createServiceClient();
  const { data: triggerRows } = await serviceClient
    .from("triggers")
    .select("id, type, is_active")
    .eq("program_id", params.id);

  const dbTriggerCount = (triggerRows ?? []).length;
  const activeTriggerCount = (triggerRows ?? []).filter(
    (t: { is_active: boolean }) => t.is_active
  ).length;

  // Fetch conflict info
  const { data: linkedConns } = await serviceClient
    .from("program_connections")
    .select("connection_id")
    .eq("program_id", params.id);

  const connectionIds = (linkedConns ?? []).map(
    (r: { connection_id: string }) => r.connection_id
  );
  let conflictingProgramCount = 0;
  if (connectionIds.length > 0) {
    const { data: sharedLinks } = await serviceClient
      .from("program_connections")
      .select("program_id")
      .in("connection_id", connectionIds)
      .neq("program_id", params.id);
    const uniq = new Set((sharedLinks ?? []).map((r: { program_id: string }) => r.program_id));
    conflictingProgramCount = uniq.size;
  }

  const NODE_BADGE: Record<string, "default" | "secondary" | "outline"> = {
    trigger: "default",
    agent: "secondary",
    step: "outline",
    connection: "outline",
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link
            href="/dashboard"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            ← Programs
          </Link>
          <h1 className="text-xl font-semibold mt-1">{program.name}</h1>
          {program.description && (
            <p className="text-sm text-muted-foreground mt-0.5">{program.description}</p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
          <Badge variant={program.is_active ? "success" : "secondary"}>
            {program.is_active ? "Active" : "Inactive"}
          </Badge>
          <Badge variant="outline" className="capitalize">{program.execution_mode}</Badge>
          <Button asChild size="sm">
            <Link href={`/programs/${program.id}/editor`}>Open Editor</Link>
          </Button>
          <DeleteProgramButton programId={program.id} programName={program.name} />
        </div>
      </div>

      {/* Conflict warning */}
      {conflictingProgramCount > 0 && (
        <div className="rounded-lg border border-yellow-500/40 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-700 dark:text-yellow-400 flex items-start gap-2">
          <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 shrink-0 mt-0.5">
              <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
            </svg>
          <span>
            {conflictingProgramCount} other program{conflictingProgramCount > 1 ? "s" : ""} share connections with this program.
            {" "}
            <Link
              href={`/programs/${params.id}/conflicts`}
              className="underline underline-offset-2"
            >
              View conflicts
            </Link>
            {" — "}current policy: <strong className="capitalize">{program.conflict_policy}</strong>.
          </span>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: "Nodes", value: nodes.length },
          { label: "Edges", value: edges.length },
          {
            label: "Triggers",
            value: dbTriggerCount,
            sub: activeTriggerCount > 0 ? `${activeTriggerCount} active` : undefined,
            href: `/programs/${params.id}/triggers`,
          },
          { label: "Schema v", value: program.schema_version ?? 1 },
        ].map(({ label, value, sub, href }) => (
          <Card key={label} className={href ? "hover:bg-accent/50 transition-colors" : ""}>
            {href ? (
              <Link href={href} className="block">
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs text-muted-foreground uppercase tracking-wide">{label}</CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  <p className="text-2xl font-semibold">{value}</p>
                  {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
                </CardContent>
              </Link>
            ) : (
              <>
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs text-muted-foreground uppercase tracking-wide">{label}</CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  <p className="text-2xl font-semibold">{value}</p>
                </CardContent>
              </>
            )}
          </Card>
        ))}
      </div>

      {/* Quick nav */}
      <div className="flex gap-2 flex-wrap">
        <Button asChild variant="outline" size="sm">
          <Link href={`/programs/${params.id}/runs`}>View Run History</Link>
        </Button>
        <Button asChild variant="outline" size="sm">
          <Link href={`/programs/${params.id}/triggers`}>Manage Triggers</Link>
        </Button>
        {conflictingProgramCount > 0 && (
          <Button asChild variant="outline" size="sm">
            <Link href={`/programs/${params.id}/conflicts`}>Conflict Settings</Link>
          </Button>
        )}
      </div>

      {/* Node list */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Nodes</CardTitle>
        </CardHeader>
        <CardContent className="pt-0 divide-y divide-border">
          {nodes.length === 0 ? (
            <p className="text-sm text-muted-foreground py-2">No nodes.</p>
          ) : (
            nodes.map((node, i) => (
              <div key={i} className="py-3 flex items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">{node.label}</p>
                  <p className="text-xs text-muted-foreground">{node.description}</p>
                </div>
                <Badge variant={NODE_BADGE[node.type] ?? "outline"} className="capitalize shrink-0">
                  {node.type}
                </Badge>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {/* Execution controls (mode switcher + conflict policy) */}
      <ExecutionControls
        programId={program.id}
        executionMode={program.execution_mode ?? "supervised"}
        conflictPolicy={program.conflict_policy ?? "queue"}
      />

      {/* Run panel */}
      <RunPanel programId={program.id} />

      {/* Raw schema */}
      <details>
        <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground select-none">
          Raw schema (JSON)
        </summary>
        <pre className="mt-3 text-xs bg-muted rounded-lg p-4 overflow-x-auto whitespace-pre-wrap break-all">
          {JSON.stringify(program.schema, null, 2)}
        </pre>
      </details>

      <Button variant="outline" asChild>
        <Link href="/dashboard">← Dashboard</Link>
      </Button>
    </div>
  );
}
