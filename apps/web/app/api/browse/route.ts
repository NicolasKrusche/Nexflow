import { NextResponse } from "next/server";
import { apiError, createServiceClient } from "@/lib/api";

/**
 * GET /api/browse
 *
 * Lists all publicly published programs.
 *
 * Query params:
 *   tag     — filter by a single tag (exact match)
 *   q       — search name/description (case-insensitive, optional)
 *   limit   — max results (default 48, max 96)
 *   offset  — pagination offset (default 0)
 *
 * No authentication required — public endpoint.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const tag    = searchParams.get("tag") ?? undefined;
  const q      = searchParams.get("q")?.trim() ?? undefined;
  const limit  = Math.min(parseInt(searchParams.get("limit") ?? "48", 10), 96);
  const offset = parseInt(searchParams.get("offset") ?? "0", 10);

  const db = createServiceClient();

  let query = db
    .from("programs")
    .select(
      "id, name, description, tags, fork_count, published_at, public_author_name, schema, schema_version",
      { count: "exact" }
    )
    .eq("is_public", true)
    .order("published_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (tag) {
    query = query.contains("tags", [tag]);
  }

  if (q) {
    // ilike on name OR description
    query = query.or(`name.ilike.%${q}%,description.ilike.%${q}%`);
  }

  const { data, error, count } = await query;

  if (error) return apiError(error.message, 500);

  type ProgramRow = {
    id: string;
    name: string;
    description: string | null;
    tags: string[];
    fork_count: number;
    published_at: string | null;
    public_author_name: string | null;
    schema: unknown;
    schema_version: number;
  };

  const programs = ((data ?? []) as unknown as ProgramRow[]).map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    tags: p.tags ?? [],
    fork_count: p.fork_count ?? 0,
    published_at: p.published_at,
    public_author_name: p.public_author_name,
    schema_version: p.schema_version,
    // Derive node summary from schema without returning the full schema
    node_summary: deriveNodeSummary(p.schema),
  }));

  return NextResponse.json({ programs, total: count ?? 0 });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

type NodeSummary = {
  total: number;
  connections_needed: string[]; // unique provider/connection type names
  has_ai: boolean;
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
    if (node.type === "connection" && node.connection && typeof node.connection === "string") {
      // Derive the provider from the connection name heuristic (e.g. "My Gmail" → "Gmail")
      const config = node.config as Record<string, unknown> | undefined;
      if (config?.connector_type && typeof config.connector_type === "string") {
        connections.add(config.connector_type);
      } else if (node.connection) {
        connections.add(node.connection as string);
      }
    }
  }

  return {
    total: nodes.length,
    connections_needed: [...connections],
    has_ai: hasAi,
  };
}
