import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { apiError } from "@/lib/api";

// GET /api/connections
export async function GET() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiError("Unauthorized", 401);

  const { data, error } = await supabase
    .from("connections")
    .select("id, name, provider, auth_type, scopes, metadata, is_valid, last_validated_at, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) return apiError(error.message, 500);
  return NextResponse.json(data);
}
