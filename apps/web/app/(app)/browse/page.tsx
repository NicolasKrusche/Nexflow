import { createServiceClient } from "@/lib/api";
import { BrowseClient } from "./browse-client";

type NodeSummary = {
  total: number;
  connections_needed: string[];
  has_ai: boolean;
};

type PublicProgram = {
  id: string;
  name: string;
  description: string | null;
  tags: string[];
  fork_count: number;
  published_at: string | null;
  public_author_name: string | null;
  schema_version: number;
  node_summary: NodeSummary;
};

function deriveNodeSummary(schema: unknown): NodeSummary {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    return { total: 0, connections_needed: [], has_ai: false };
  }
  const s = schema as Record<string, unknown>;
  const nodes = Array.isArray(s.nodes) ? (s.nodes as Record<string, unknown>[]) : [];
  const connections = new Set<string>();
  let hasAi = false;
  for (const node of nodes) {
    if (node.type === "agent") hasAi = true;
    if (node.type === "connection") {
      const config = node.config as Record<string, unknown> | undefined;
      if (config?.connector_type && typeof config.connector_type === "string") {
        connections.add(config.connector_type);
      } else if (node.connection && typeof node.connection === "string") {
        connections.add(node.connection);
      }
    }
  }
  return { total: nodes.length, connections_needed: [...connections], has_ai: hasAi };
}

export default async function BrowsePage() {
  const db = createServiceClient();

  const { data, count } = await db
    .from("programs")
    .select(
      "id, name, description, tags, fork_count, published_at, public_author_name, schema, schema_version",
      { count: "exact" }
    )
    .eq("is_public", true)
    .order("published_at", { ascending: false })
    .range(0, 47);

  const programs: PublicProgram[] = ((data ?? []) as unknown as Array<{
    id: string;
    name: string;
    description: string | null;
    tags: string[];
    fork_count: number;
    published_at: string | null;
    public_author_name: string | null;
    schema: unknown;
    schema_version: number;
  }>).map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    tags: p.tags ?? [],
    fork_count: p.fork_count ?? 0,
    published_at: p.published_at,
    public_author_name: p.public_author_name,
    schema_version: p.schema_version,
    node_summary: deriveNodeSummary(p.schema),
  }));

  return <BrowseClient initialPrograms={programs} initialTotal={count ?? 0} />;
}
