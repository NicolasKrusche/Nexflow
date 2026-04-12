import { createServerClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/api";
import { redirect } from "next/navigation";
import { ApprovalCard } from "./approval-card";
import { ApprovalsRealtimeRefresh } from "./realtime-refresh";

// ─── Types ────────────────────────────────────────────────────────────────────

type ApprovalRow = {
  id: string;
  node_execution_id: string;
  user_id: string;
  status: string;
  context: {
    node_label?: string;
    input?: unknown;
    program_id?: string;
  } | null;
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

// ─── Server component ─────────────────────────────────────────────────────────

export default async function ApprovalsPage() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const serviceClient = createServiceClient();

  const { data: approvalsRaw } = await serviceClient
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

  const approvals = (approvalsRaw ?? []) as unknown as ApprovalRow[];

  return (
    <div className="space-y-6">
      <ApprovalsRealtimeRefresh />
      <div>
        <h1 className="text-2xl font-semibold">Pending approvals</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Review and approve or reject agent actions that require human sign-off.
        </p>
      </div>

      {approvals.length === 0 ? (
        <div className="rounded-lg border border-border p-8 text-center">
          <p className="text-sm text-muted-foreground">
            No pending approvals. You're all caught up.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {approvals.map((approval) => (
            <ApprovalCard key={approval.id} approval={approval} />
          ))}
        </div>
      )}
    </div>
  );
}
