import { NextResponse } from "next/server";
import { z } from "zod";
import { ProgramSchemaZ, type ProgramSchema, type AgentNode } from "@flowos/schema";
import { apiError, createServiceClient } from "@/lib/api";
import { createServerClient } from "@/lib/supabase/server";
import { getDefaultModelForProvider, validatePreFlight } from "@/lib/validation/pre-flight";

const remediationSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("assign_agent_defaults"),
    node_id: z.string().min(1),
  }),
  z.object({
    type: z.literal("remove_invalid_edge"),
    edge_id: z.string().min(1),
  }),
]);

const requestSchema = z.object({
  remediation: remediationSchema,
});

// POST /api/programs/[id]/preflight/fix - apply one safe remediation and re-run pre-flight
export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return apiError("Unauthorized", 401);

  const body = await request.json().catch(() => null);
  const parsedBody = requestSchema.safeParse(body);
  if (!parsedBody.success) return apiError(parsedBody.error.message, 400);

  const { data: programRow, error: programError } = await supabase
    .from("programs")
    .select("id, schema, schema_version")
    .eq("id", params.id)
    .eq("user_id", user.id)
    .single();

  if (programError || !programRow) return apiError("Program not found", 404);
  type ProgramRow = { id: string; schema: unknown; schema_version: number | null };
  const program = programRow as unknown as ProgramRow;

  const parsedSchema = ProgramSchemaZ.safeParse(program.schema);
  if (!parsedSchema.success) {
    return apiError("Program schema is invalid and cannot be auto-fixed", 409);
  }

  const serviceClient = createServiceClient();
  const remediation = parsedBody.data.remediation;

  let nextSchema = parsedSchema.data as ProgramSchema;
  let changeSummary = "Pre-flight remediation";

  if (remediation.type === "remove_invalid_edge") {
    const edgeExists = nextSchema.edges.some((edge) => edge.id === remediation.edge_id);
    if (!edgeExists) return apiError("Edge was already removed", 409);

    nextSchema = {
      ...nextSchema,
      edges: nextSchema.edges.filter((edge) => edge.id !== remediation.edge_id),
      updated_at: new Date().toISOString(),
    };

    changeSummary = `Pre-flight fix: removed invalid edge ${remediation.edge_id}`;
  }

  if (remediation.type === "assign_agent_defaults") {
    const nodeIndex = nextSchema.nodes.findIndex((node) => node.id === remediation.node_id);
    if (nodeIndex === -1) return apiError("Target node not found", 404);

    const targetNode = nextSchema.nodes[nodeIndex];
    if (!targetNode || targetNode.type !== "agent") {
      return apiError("Only agent nodes support this remediation", 400);
    }

    const agentNode = targetNode as AgentNode;

    const { data: validKeysRaw } = await serviceClient
      .from("api_keys")
      .select("id, name, provider, is_valid")
      .eq("user_id", user.id)
      .eq("is_valid", true);

    type ValidKey = { id: string; name: string; provider: string; is_valid: boolean };
    const validKeys = (validKeysRaw ?? []) as ValidKey[];
    if (validKeys.length === 0) {
      return apiError("No valid API key is available for auto-assignment", 409);
    }

    const currentKeyRef = agentNode.config.api_key_ref;
    const selectedKey =
      validKeys.find((key) => key.id === currentKeyRef) ??
      [...validKeys].sort((a, b) => a.name.localeCompare(b.name))[0];

    if (!selectedKey) {
      return apiError("No valid API key is available for auto-assignment", 409);
    }

    let nextModel = agentNode.config.model;
    if (nextModel === "__USER_ASSIGNED__") {
      const defaultModel = getDefaultModelForProvider(selectedKey.provider);
      if (!defaultModel) {
        return apiError(
          `No default model preset is configured for provider \"${selectedKey.provider}\"`,
          409
        );
      }
      nextModel = defaultModel;
    }

    const patchedNode: AgentNode = {
      ...agentNode,
      config: {
        ...agentNode.config,
        api_key_ref: selectedKey.id,
        model: nextModel,
      },
    };

    const nextNodes = [...nextSchema.nodes];
    nextNodes[nodeIndex] = patchedNode;

    nextSchema = {
      ...nextSchema,
      nodes: nextNodes,
      updated_at: new Date().toISOString(),
    };

    changeSummary = `Pre-flight fix: assigned model and API key for node ${agentNode.id}`;
  }

  const nextVersion = (program.schema_version ?? 0) + 1;
  const now = new Date().toISOString();

  const { error: updateError } = await supabase
    .from("programs")
    .update({
      schema: nextSchema as unknown,
      schema_version: nextVersion,
      updated_at: now,
    } as unknown as never)
    .eq("id", params.id)
    .eq("user_id", user.id);

  if (updateError) return apiError(updateError.message, 500);

  await supabase
    .from("program_versions")
    .insert({
      program_id: params.id,
      version: nextVersion,
      schema: nextSchema as unknown,
      change_summary: changeSummary,
    } as unknown as never);

  const { data: linkedConnsRaw } = await serviceClient
    .from("program_connections")
    .select("connection_id")
    .eq("program_id", params.id);

  const connectionIds = (linkedConnsRaw ?? []).map(
    (row: { connection_id: string }) => row.connection_id
  );

  let connections: Array<{
    id: string;
    name: string;
    provider: string;
    scopes: string[] | null;
    is_valid: boolean;
  }> = [];

  if (connectionIds.length > 0) {
    const { data: connRows } = await serviceClient
      .from("connections")
      .select("id, name, provider, scopes, is_valid")
      .in("id", connectionIds)
      .eq("user_id", user.id);

    connections = (connRows ?? []) as typeof connections;
  }

  const { data: apiKeysRaw } = await serviceClient
    .from("api_keys")
    .select("id, name, provider, is_valid")
    .eq("user_id", user.id);

  const { result, checks } = await validatePreFlight(
    nextSchema,
    connections,
    (apiKeysRaw ?? []) as Array<{ id: string; name: string; provider: string; is_valid: boolean }>
  );

  return NextResponse.json({
    ok: true,
    applied: remediation.type,
    validation: { result, checks },
  });
}
