import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { Sidebar } from "@/components/sidebar";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  return (
    <div className="min-h-screen bg-background">
      <Sidebar />
      <main className="ml-56 min-h-screen p-8 relative">
        {/* Subtle ambient gradient — top right */}
        <div
          className="pointer-events-none fixed top-0 right-0 w-[700px] h-[500px] -z-10"
          style={{ background: "radial-gradient(ellipse at 100% 0%, rgba(249,115,22,0.04) 0%, transparent 60%)" }}
        />
        {children}
      </main>
    </div>
  );
}
