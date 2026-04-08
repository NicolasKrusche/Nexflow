import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { apiError } from "@/lib/api";

export async function GET(request: Request) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiError("Unauthorized", 401);

  const { searchParams } = new URL(request.url);
  const label = searchParams.get("label") ?? "asana:primary";

  const params = new URLSearchParams({
    client_id: process.env.ASANA_CLIENT_ID!,
    redirect_uri: `${process.env.NEXT_PUBLIC_APP_URL}/api/connections/oauth/asana/callback`,
    response_type: "code",
    state: Buffer.from(JSON.stringify({ userId: user.id, label })).toString("base64url"),
  });

  return NextResponse.redirect(
    `https://app.asana.com/-/oauth_authorize?${params.toString()}`
  );
}
