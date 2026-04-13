import { NextResponse } from "next/server";
import { apiError, createServiceClient, getAuthUser } from "@/lib/api";
import { createServerClient } from "@/lib/supabase/server";

// GET /api/runs/[id]
// Returns run row + node_executions for that run, ordered by created_at
export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const user = await getAuthUser();
  if (!user) return apiError("Unauthorized", 401);

  const { id: runId } = params;

  const serviceClient = createServiceClient();

  // Fetch the run, verify it belongs to the user via the program
  type RunRow = {
    id: string;
    program_id: string;
    status: string;
    triggered_by: string;
    trigger_payload: unknown;
    started_at: string | null;
    completed_at: string | null;
    error_message: string | null;
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    estimated_cost_usd: number;
    connector_api_calls: number;
    model_call_count: number;
    created_at: string;
  };

  const { data: runRaw, error: runError } = await serviceClient
    .from("runs")
    .select(
      "id, program_id, status, triggered_by, trigger_payload, started_at, completed_at, error_message, prompt_tokens, completion_tokens, total_tokens, estimated_cost_usd, connector_api_calls, model_call_count, created_at"
    )
    .eq("id", runId)
    .single();

  if (runError || !runRaw) return apiError("Run not found", 404);

  const run = runRaw as unknown as RunRow;

  // Verify the program belongs to the current user
  const supabase = await createServerClient();
  const { data: program, error: progError } = await supabase
    .from("programs")
    .select("id, name, schema")
    .eq("id", run.program_id)
    .eq("user_id", user.id)
    .single();

  if (progError || !program) return apiError("Run not found", 404);

  type ProgramRow = { id: string; name: string; schema: unknown };
  const prog = program as unknown as ProgramRow;

  // Fetch node_executions for this run
  type NodeExecutionRow = {
    id: string;
    node_id: string;
    status: string;
    input_payload: unknown;
    output_payload: unknown;
    error_message: string | null;
    retry_count: number | null;
    started_at: string | null;
    completed_at: string | null;
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    estimated_cost_usd: number;
    connector_api_calls: number;
    model_call_count: number;
    created_at: string;
  };

  const { data: execsRaw, error: execsError } = await serviceClient
    .from("node_executions")
    .select(
      "id, node_id, status, input_payload, output_payload, error_message, retry_count, started_at, completed_at, prompt_tokens, completion_tokens, total_tokens, estimated_cost_usd, connector_api_calls, model_call_count, created_at"
    )
    .eq("run_id", runId)
    .order("created_at", { ascending: true });

  if (execsError) return apiError(execsError.message, 500);

  const node_executions = (execsRaw ?? []) as unknown as NodeExecutionRow[];

  return NextResponse.json({
    run,
    program: { id: prog.id, name: prog.name, schema: prog.schema },
    node_executions,
  });
}
