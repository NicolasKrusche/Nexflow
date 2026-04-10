import { NextResponse } from "next/server";
import { z } from "zod";
import { createServerClient } from "@/lib/supabase/server";
import { apiError } from "@/lib/api";
import { ProgramSchemaZ } from "@flowos/schema";
import type { ProgramSchema } from "@flowos/schema";
import { validatePostGenesis } from "@/lib/validation";

const ImportProgramBodyZ = z.object({
  json: z.string().optional(),
  schema: z.unknown().optional(),
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(5000).optional(),
});

type ConnectionRow = {
  id: string;
  name: string;
  provider: string;
  scopes: string[] | null;
};

function stripMarkdownCodeFence(input: string): string {
  return input
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function extractSchemaCandidate(raw: unknown): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const candidate = raw as Record<string, unknown>;
  if ("schema" in candidate) return candidate.schema;
  return raw;
}

function mapExecutionMode(mode: ProgramSchema["execution_mode"]): "autonomous" | "supervised" | "manual" {
  return mode === "approval_required" ? "supervised" : mode;
}

function getSchemaConnectionNames(schema: ProgramSchema): string[] {
  const names = new Set<string>();
  for (const node of schema.nodes) {
    if (!node.connection) continue;
    const trimmed = node.connection.trim();
    if (trimmed.length > 0) names.add(trimmed);
  }
  return [...names];
}

// POST /api/programs/import
export async function POST(request: Request) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiError("Unauthorized", 401);

  const body = await request.json().catch(() => null);
  const parsed = ImportProgramBodyZ.safeParse(body);
  if (!parsed.success) return apiError(parsed.error.message, 400);

  if (!parsed.data.schema && !parsed.data.json) {
    return apiError("Provide either `schema` or `json`", 400);
  }

  let parsedJson: unknown = parsed.data.schema;
  if (!parsedJson && parsed.data.json) {
    try {
      parsedJson = JSON.parse(stripMarkdownCodeFence(parsed.data.json));
    } catch {
      return apiError("JSON could not be parsed. Check for syntax errors and try again.", 400);
    }
  }

  const schemaCandidate = extractSchemaCandidate(parsedJson);
  const schemaResult = ProgramSchemaZ.safeParse(schemaCandidate);
  if (!schemaResult.success) {
    return NextResponse.json(
      { error: "Imported JSON is not a valid ProgramSchema", details: schemaResult.error.flatten() },
      { status: 422 }
    );
  }

  // Cast through unknown to bridge DataSchema typing variance between zod output and shared interface.
  const schema = schemaResult.data as unknown as ProgramSchema;
  const now = new Date().toISOString();

  const finalName = parsed.data.name?.trim() || schema.program_name;
  const finalDescription = (parsed.data.description?.trim() ?? schema.metadata.description ?? "").trim();

  const normalizedSchema: ProgramSchema = {
    ...schema,
    updated_at: now,
    program_name: finalName,
    metadata: {
      ...schema.metadata,
      description: finalDescription,
    },
  };

  const referencedConnectionNames = getSchemaConnectionNames(normalizedSchema);
  let matchedConnections: ConnectionRow[] = [];

  if (referencedConnectionNames.length > 0) {
    const { data: connectionsRaw, error: connError } = await supabase
      .from("connections")
      .select("id, name, provider, scopes")
      .eq("user_id", user.id)
      .in("name", referencedConnectionNames);

    if (connError) return apiError(connError.message, 500);
    matchedConnections = (connectionsRaw ?? []) as unknown as ConnectionRow[];
  }

  const validation = validatePostGenesis(normalizedSchema, matchedConnections);

  const { data: programRaw, error: insertError } = await supabase
    .from("programs")
    .insert({
      user_id: user.id,
      name: finalName,
      description: finalDescription || null,
      schema: normalizedSchema as unknown as Record<string, unknown>,
      execution_mode: mapExecutionMode(normalizedSchema.execution_mode),
      is_active: normalizedSchema.metadata.is_active,
      updated_at: now,
    } as unknown as never)
    .select("id, name, description, execution_mode, is_active, schema_version, created_at, updated_at")
    .single();

  if (insertError || !programRaw) return apiError(insertError?.message ?? "Failed to import program", 500);

  const program = programRaw as unknown as {
    id: string;
    name: string;
    description: string | null;
    execution_mode: string;
    is_active: boolean;
    schema_version: number;
    created_at: string;
    updated_at: string;
  };

  if (matchedConnections.length > 0) {
    const { error: linkError } = await supabase.from("program_connections").insert(
      matchedConnections.map((conn) => ({ program_id: program.id, connection_id: conn.id })) as unknown as never
    );
    if (linkError) console.error("[program import] Failed to link connections:", linkError.message);
  }

  const { error: versionErr } = await supabase.from("program_versions").insert({
    program_id: program.id,
    version: 0,
    schema: normalizedSchema as unknown as Record<string, unknown>,
    change_summary: "Imported from JSON",
  } as unknown as never);

  if (versionErr) console.error("[program import] Failed to store version snapshot:", versionErr.message);

  const linkedConnectionNames = new Set(matchedConnections.map((conn) => conn.name));
  const missingConnectionNames = referencedConnectionNames.filter((name) => !linkedConnectionNames.has(name));

  return NextResponse.json(
    {
      program,
      validation,
      linked_connection_names: [...linkedConnectionNames],
      missing_connection_names: missingConnectionNames,
    },
    { status: 201 }
  );
}
