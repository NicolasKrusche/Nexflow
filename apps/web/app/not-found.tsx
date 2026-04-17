import Link from "next/link";
import { createServerClient } from "@/lib/supabase/server";

// fix: route "Go home" to /dashboard for authenticated users, / for guests
export default async function NotFound() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const href = user ? "/dashboard" : "/";

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4">
      <h2 className="text-lg font-semibold">Page not found</h2>
      <Link href={href} className="text-sm text-primary underline">
        Go home
      </Link>
    </div>
  );
}
