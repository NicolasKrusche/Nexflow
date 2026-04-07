import { NextResponse } from "next/server";
import { apiError, createServiceClient, getAuthUser } from "@/lib/api";

// GET /api/approvals — list pending approvals for the current user
export async function GET() {
  const user = await getAuthUser();
  if (!user) return apiError("Unauthorized", 401);

  const serviceClient = createServiceClient();

  // Fetch pending approvals with context from node_executions → runs → programs
  type ApprovalRow = {
    id: string;
    node_execution_id: string;
    user_id: string;
    status: string;
    context: unknown;
    decision_note: string | null;
    decided_at: string | null;
    created_at: string;
    node_executions: {
      id: string;
      node_id: string;
      run_id: string;
      runs: {
        id: string;
        program_id: string;
        programs: {
          id: string;
          name: string;
        };
      };
    };
  };

  const { data: approvalsRaw, error } = await serviceClient
    .from("approvals")
    .select(
      `id,
       node_execution_id,
       user_id,
       status,
       context,
       decision_note,
       decided_at,
       created_at,
       node_executions (
         id,
         node_id,
         run_id,
         runs (
           id,
           program_id,
           programs (
             id,
             name
           )
         )
       )`
    )
    .eq("user_id", user.id)
    .eq("status", "pending")
    .order("created_at", { ascending: false });

  if (error) return apiError(error.message, 500);

  const approvals = (approvalsRaw ?? []) as unknown as ApprovalRow[];
  return NextResponse.json({ approvals });
}
