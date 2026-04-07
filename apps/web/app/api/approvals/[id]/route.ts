import { NextResponse } from "next/server";
import { apiError, createServiceClient, getAuthUser } from "@/lib/api";

// POST /api/approvals/[id]
// Body: { decision: "approved" | "rejected"; note?: string }
// Updates approval status and node_execution accordingly
export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const user = await getAuthUser();
  if (!user) return apiError("Unauthorized", 401);

  const body = await request.json().catch(() => null);
  if (!body || !["approved", "rejected"].includes(body.decision)) {
    return apiError('decision must be "approved" or "rejected"', 400);
  }

  const { decision, note } = body as { decision: "approved" | "rejected"; note?: string };
  const { id: approvalId } = params;

  const serviceClient = createServiceClient();

  // Fetch approval to verify ownership and get node_execution_id
  type ApprovalRow = {
    id: string;
    user_id: string;
    status: string;
    node_execution_id: string;
  };

  const { data: approvalRaw, error: fetchError } = await serviceClient
    .from("approvals")
    .select("id, user_id, status, node_execution_id")
    .eq("id", approvalId)
    .single();

  if (fetchError || !approvalRaw) return apiError("Approval not found", 404);

  const approval = approvalRaw as unknown as ApprovalRow;

  if (approval.user_id !== user.id) return apiError("Unauthorized", 403);
  if (approval.status !== "pending") {
    return apiError("Approval has already been decided", 409);
  }

  const now = new Date().toISOString();

  // Update approval
  const { error: updateApprovalError } = await serviceClient
    .from("approvals")
    .update({
      status: decision,
      decision_note: note ?? null,
      decided_at: now,
    } as unknown as never)
    .eq("id", approvalId);

  if (updateApprovalError) return apiError(updateApprovalError.message, 500);

  // Update node_execution status
  const nodeExecStatus = decision === "approved" ? "running" : "failed";
  const { error: updateExecError } = await serviceClient
    .from("node_executions")
    .update({ status: nodeExecStatus } as unknown as never)
    .eq("id", approval.node_execution_id);

  if (updateExecError) return apiError(updateExecError.message, 500);

  return NextResponse.json({ success: true, decision });
}
