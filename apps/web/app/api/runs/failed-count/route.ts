import { NextResponse } from "next/server";
import { apiError, createServiceClient, getAuthUser } from "@/lib/api";

// GET /api/runs/failed-count
// Returns { count: N } — number of failed runs in the last 7 days for the current user.
// Used by the sidebar to show a notification badge.
export async function GET(request: Request) {
  const user = await getAuthUser();
  if (!user) return apiError("Unauthorized", 401);

  const serviceClient = createServiceClient();

  // Get this user's program IDs first (RLS-safe)
  const { data: programsRaw } = await serviceClient
    .from("programs")
    .select("id")
    .eq("user_id", user.id);

  const programIds = (programsRaw ?? []).map((p: { id: string }) => p.id);
  if (programIds.length === 0) return NextResponse.json({ count: 0 });

  // Use client-supplied "since" (last time user visited /runs) if provided,
  // otherwise fall back to 7-day window.
  const sinceParam = new URL(request.url).searchParams.get("since");
  const since = sinceParam
    ? new Date(parseInt(sinceParam, 10)).toISOString()
    : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const { count, error } = await serviceClient
    .from("runs")
    .select("id", { count: "exact", head: true })
    .in("program_id", programIds)
    .eq("status", "failed")
    .gte("created_at", since);

  if (error) return NextResponse.json({ count: 0 });

  return NextResponse.json({ count: count ?? 0 });
}
