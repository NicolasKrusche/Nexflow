import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { apiError } from "@/lib/api";

const SCOPES_BY_SERVICE: Record<string, string[]> = {
  sheets: [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive.readonly",
    "https://www.googleapis.com/auth/userinfo.email",
  ],
  calendar: [
    "https://www.googleapis.com/auth/calendar",
    "https://www.googleapis.com/auth/userinfo.email",
  ],
  docs: [
    "https://www.googleapis.com/auth/documents",
    "https://www.googleapis.com/auth/userinfo.email",
  ],
  drive: [
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/userinfo.email",
  ],
};

// GET /api/connections/oauth/google?service=sheets|calendar|docs|drive
export async function GET(request: Request) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiError("Unauthorized", 401);

  const { searchParams } = new URL(request.url);
  const service = searchParams.get("service") ?? "sheets";
  const label = searchParams.get("label") ?? `${service}:primary`;

  const scopes = SCOPES_BY_SERVICE[service];
  if (!scopes) return apiError("Unknown Google service", 400);

  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: `${process.env.NEXT_PUBLIC_APP_URL}/api/connections/oauth/google/callback`,
    response_type: "code",
    scope: scopes.join(" "),
    access_type: "offline",
    prompt: "consent",
    state: Buffer.from(JSON.stringify({ userId: user.id, service, label })).toString("base64url"),
  });

  return NextResponse.redirect(
    `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
  );
}
