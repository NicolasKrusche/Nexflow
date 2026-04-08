import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { apiError } from "@/lib/api";

const TYPEFORM_SCOPES = ["responses:read", "forms:read"].join("+");

export async function GET(request: Request) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiError("Unauthorized", 401);

  const { searchParams } = new URL(request.url);
  const label = searchParams.get("label") ?? "typeform:primary";

  const params = new URLSearchParams({
    client_id: process.env.TYPEFORM_CLIENT_ID!,
    redirect_uri: `${process.env.NEXT_PUBLIC_APP_URL}/api/connections/oauth/typeform/callback`,
    response_type: "code",
    scope: TYPEFORM_SCOPES,
    state: Buffer.from(JSON.stringify({ userId: user.id, label })).toString("base64url"),
  });

  return NextResponse.redirect(
    `https://api.typeform.com/oauth/authorize?${params.toString()}`
  );
}
