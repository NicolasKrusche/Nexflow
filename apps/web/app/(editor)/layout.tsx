import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";

// Full-width layout for the visual editor — no nav sidebar, no padding.
// Auth is still enforced.

export default async function EditorGroupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  return (
    <div className="min-h-screen bg-background overflow-hidden">
      {children}
    </div>
  );
}
