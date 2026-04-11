import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { connection_id } = await req.json();
  if (!connection_id) return NextResponse.json({ error: "connection_id required" }, { status: 400 });

  // Verify program belongs to user
  const { data: program } = await supabase
    .from("programs")
    .select("id")
    .eq("id", params.id)
    .eq("user_id", user.id)
    .single();
  if (!program) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Verify connection belongs to user
  const { data: connection } = await supabase
    .from("connections")
    .select("id")
    .eq("id", connection_id)
    .eq("user_id", user.id)
    .single();
  if (!connection) return NextResponse.json({ error: "Connection not found" }, { status: 404 });

  // Upsert (ignore if already linked)
  const { error } = await supabase
    .from("program_connections")
    .upsert({ program_id: params.id, connection_id }, { onConflict: "program_id,connection_id", ignoreDuplicates: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
