import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import type { Database } from "@flowos/db";

const PUBLIC_ROUTES = ["/login", "/signup", "/forgot-password", "/auth/callback"];

export async function middleware(request: NextRequest) {
  // If Supabase isn't configured yet, allow all public routes through
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const { pathname } = request.nextUrl;

  const isPublic = PUBLIC_ROUTES.some((r) => pathname.startsWith(r));

  if (!supabaseUrl || supabaseUrl.includes("placeholder") || !supabaseKey || supabaseKey.includes("placeholder")) {
    if (!isPublic) {
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      return NextResponse.redirect(url);
    }
    return NextResponse.next({ request });
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient<Database>(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options)
        );
      },
    },
  });

  let user = null;
  try {
    const { data, error } = await supabase.auth.getUser();
    user = data.user;
    console.log("[middleware] path:", pathname, "user:", user?.email ?? null, "error:", error?.message ?? null);
    const allCookies = request.cookies.getAll();
    console.log("[middleware] cookies:", allCookies.map(c => `${c.name}=${c.value.slice(0, 40)}`).join(" | "));
  } catch (e) {
    console.log("[middleware] exception:", e);
  }

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (user && (pathname === "/login" || pathname === "/signup")) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
