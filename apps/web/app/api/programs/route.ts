import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { apiError } from "@/lib/api";

// GET /api/programs
export async function GET() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiError("Unauthorized", 401);

  const { data, error } = await supabase
    .from("programs")
    .select("id, name, description, execution_mode, is_active, schema_version, last_run_at, created_at, updated_at")
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false });

  if (error) return apiError(error.message, 500);
  return NextResponse.json(data);
}
