import { NextResponse } from "next/server";
import { apiError, createServiceClient, getAuthUser } from "@/lib/api";
import { createServerClient } from "@/lib/supabase/server";

/**
 * POST /api/runs/[id]/cancel
 *
 * Marks a run as cancelled. The Python runtime polls for this status and
 * stops gracefully on the next iteration. Releases any resource locks.
 */
export async function POST(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const user = await getAuthUser();
  if (!user) return apiError("Unauthorized", 401);

  const serviceClient = createServiceClient();

  // Fetch run
  type RunRow = { id: string; program_id: string; status: string };
  const { data: runRaw, error: runError } = await serviceClient
    .from("runs")
    .select("id, program_id, status")
    .eq("id", params.id)
    .single();

  if (runError || !runRaw) return apiError("Run not found", 404);
  const run = runRaw as unknown as RunRow;

  // Verify program ownership
  const supabase = await createServerClient();
  const { data: program, error: progError } = await supabase
    .from("programs")
    .select("id")
    .eq("id", run.program_id)
    .eq("user_id", user.id)
    .single();

  if (progError || !program) return apiError("Not found", 404);

  // Only cancel runs that are still in-flight
  if (!["running", "paused", "pending"].includes(run.status)) {
    return NextResponse.json(
      { error: `Cannot cancel run with status: ${run.status}` },
      { status: 409 }
    );
  }

  // Mark run as cancelled
  const { error: updateError } = await serviceClient
    .from("runs")
    .update({
      status: "cancelled",
      completed_at: new Date().toISOString(),
      error_message: "Cancelled by user",
    })
    .eq("id", params.id);

  if (updateError) return apiError("Failed to cancel run", 500);

  // Release any resource locks held by this run
  await serviceClient
    .from("resource_locks")
    .delete()
    .eq("locked_by_run_id", params.id);

  return NextResponse.json({ run_id: params.id, status: "cancelled" });
}
