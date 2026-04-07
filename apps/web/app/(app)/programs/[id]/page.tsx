import { createServerClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RunPanel } from "./run-panel";
import type { Json } from "@flowos/db";

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
    .select("id, name, description, execution_mode, is_active, schema, schema_version, last_run_at, updated_at")
    .eq("id", params.id)
    .eq("user_id", user.id)
    .single();

  if (error || !data) return notFound();

  // Cast to bypass Supabase's narrow return type post-notFound
  type ProgramRow = typeof data & { schema: Json };
  const program = data as ProgramRow;
  const { nodes, edges, triggers } = parseSchema(program.schema);

  const NODE_BADGE: Record<string, "default" | "secondary" | "outline"> = {
    trigger: "default",
    agent: "secondary",
    step: "outline",
    connection: "outline",
  };

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center justify-between gap-4">
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
        <div className="flex items-center gap-2 shrink-0">
          <Badge variant={program.is_active ? "success" : "secondary"}>
            {program.is_active ? "Active" : "Inactive"}
          </Badge>
          <Badge variant="outline" className="capitalize">{program.execution_mode}</Badge>
          <Button asChild size="sm">
            <Link href={`/programs/${program.id}/editor`}>Open Editor</Link>
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Nodes", value: nodes.length },
          { label: "Edges", value: edges.length },
          { label: "Triggers", value: triggers.length },
        ].map(({ label, value }) => (
          <Card key={label}>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs text-muted-foreground uppercase tracking-wide">{label}</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <p className="text-2xl font-semibold">{value}</p>
            </CardContent>
          </Card>
        ))}
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
