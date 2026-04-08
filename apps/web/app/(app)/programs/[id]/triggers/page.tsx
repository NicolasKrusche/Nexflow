import Link from "next/link";
import { notFound } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/api";
import { TriggerManager } from "./trigger-manager";

type TriggerRow = {
  id: string;
  program_id: string;
  type: string;
  config: Record<string, unknown>;
  is_active: boolean;
  webhook_url: string | null;
  next_run_at: string | null;
  last_fired_at: string | null;
  created_at: string;
};

export default async function TriggersPage({
  params,
}: {
  params: { id: string };
}) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) notFound();

  // Verify ownership
  const { data: program, error: progError } = await supabase
    .from("programs")
    .select("id, name")
    .eq("id", params.id)
    .eq("user_id", user.id)
    .single();

  if (progError || !program) notFound();

  const prog = program as unknown as { id: string; name: string };

  // Fetch triggers
  const serviceClient = createServiceClient();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  const { data: triggersRaw } = await serviceClient
    .from("triggers")
    .select(
      "id, program_id, type, config, is_active, webhook_token, next_run_at, last_fired_at, created_at"
    )
    .eq("program_id", params.id)
    .order("created_at", { ascending: false });

  type RawTrigger = TriggerRow & { webhook_token?: string };
  const triggers: TriggerRow[] = ((triggersRaw ?? []) as unknown as RawTrigger[]).map(
    (t) => ({
      ...t,
      webhook_url:
        t.type === "webhook" && t.webhook_token
          ? `${appUrl}/api/triggers/webhook/${t.webhook_token}`
          : null,
      webhook_token: undefined,
    })
  );

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <p className="text-sm text-muted-foreground mb-1">
          <Link href={`/programs/${params.id}`} className="hover:underline">
            {prog.name}
          </Link>
        </p>
        <h1 className="text-2xl font-semibold">Triggers</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Configure how and when this program runs automatically.
        </p>
      </div>

      <TriggerManager
        programId={params.id}
        initialTriggers={triggers}
      />
    </div>
  );
}
