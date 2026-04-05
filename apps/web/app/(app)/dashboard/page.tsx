import { createServerClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

type Program = {
  id: string;
  name: string;
  description: string | null;
  execution_mode: string;
  is_active: boolean;
  schema_version: number;
  last_run_at: string | null;
  updated_at: string;
};

export default async function DashboardPage() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: programs } = await supabase
    .from("programs")
    .select("id, name, description, execution_mode, is_active, schema_version, last_run_at, updated_at")
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false });

  const list = (programs ?? []) as Program[];

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Programs</h1>
        <Button asChild>
          <Link href="/programs/new">New program</Link>
        </Button>
      </div>

      {list.length === 0 ? (
        <div className="text-center py-20 border border-dashed border-border rounded-lg">
          <p className="text-sm text-muted-foreground">No programs yet.</p>
          <Button asChild className="mt-4" variant="outline">
            <Link href="/programs/new">Create your first program</Link>
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {list.map((p) => (
            <Link key={p.id} href={`/programs/${p.id}`}>
              <Card className="hover:border-ring transition-colors cursor-pointer">
                <CardContent className="py-4 px-5 flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{p.name}</p>
                    {p.description && (
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">{p.description}</p>
                    )}
                    <p className="text-xs text-muted-foreground mt-1">
                      v{p.schema_version} · Updated {new Date(p.updated_at).toLocaleDateString()}
                      {p.last_run_at && <> · Last run {new Date(p.last_run_at).toLocaleDateString()}</>}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge variant="outline" className="capitalize text-xs">
                      {p.execution_mode}
                    </Badge>
                    <Badge variant={p.is_active ? "success" : "secondary"}>
                      {p.is_active ? "Active" : "Inactive"}
                    </Badge>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
