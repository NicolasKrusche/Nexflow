import Link from "next/link";
import { notFound } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/api";
import { ConflictResolutionPanel } from "./conflict-panel";

type ConflictEntry = {
  program: { id: string; name: string; is_active: boolean; execution_mode: string };
  shared_connections: Array<{ id: string; name: string; provider: string }>;
};

export default async function ConflictsPage({
  params,
}: {
  params: { id: string };
}) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) notFound();

  const { data: program, error: progError } = await supabase
    .from("programs")
    .select("id, name, conflict_policy")
    .eq("id", params.id)
    .eq("user_id", user.id)
    .single();

  if (progError || !program) notFound();

  type ProgramRow = { id: string; name: string; conflict_policy: string };
  const prog = program as unknown as ProgramRow;

  // Fetch conflict data via service client
  const serviceClient = createServiceClient();

  const { data: linkedConns } = await serviceClient
    .from("program_connections")
    .select("connection_id")
    .eq("program_id", params.id);

  const connectionIds = (linkedConns ?? []).map(
    (r: { connection_id: string }) => r.connection_id
  );

  let conflicts: ConflictEntry[] = [];
  if (connectionIds.length > 0) {
    const { data: sharedLinks } = await serviceClient
      .from("program_connections")
      .select("program_id, connection_id")
      .in("connection_id", connectionIds)
      .neq("program_id", params.id);

    const conflictingProgramIds = [
      ...new Set(
        (
          (sharedLinks ?? []) as { program_id: string; connection_id: string }[]
        ).map((r) => r.program_id)
      ),
    ];

    if (conflictingProgramIds.length > 0) {
      const { data: conflictingPrograms } = await supabase
        .from("programs")
        .select("id, name, is_active, execution_mode")
        .in("id", conflictingProgramIds)
        .eq("user_id", user.id);

      const { data: connNames } = await serviceClient
        .from("connections")
        .select("id, name, provider")
        .in("id", connectionIds);

      type ConnRow = { id: string; name: string; provider: string };
      const connMap = Object.fromEntries(
        ((connNames ?? []) as unknown as ConnRow[]).map((c) => [c.id, c])
      );

      type ConflictProg = {
        id: string;
        name: string;
        is_active: boolean;
        execution_mode: string;
      };
      type SharedLink = { program_id: string; connection_id: string };

      conflicts = ((conflictingPrograms ?? []) as unknown as ConflictProg[]).map(
        (p) => ({
          program: p,
          shared_connections: (
            (sharedLinks ?? []) as unknown as SharedLink[]
          )
            .filter((s) => s.program_id === p.id)
            .map((s) => connMap[s.connection_id])
            .filter(Boolean) as ConnRow[],
        })
      );
    }
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <p className="text-sm text-muted-foreground mb-1">
          <Link href={`/programs/${params.id}`} className="hover:underline">
            {prog.name}
          </Link>
        </p>
        <h1 className="text-2xl font-semibold">Conflict Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage how concurrent runs are handled when programs share connections.
        </p>
      </div>

      <ConflictResolutionPanel
        programId={params.id}
        conflictPolicy={prog.conflict_policy}
        conflicts={conflicts}
      />
    </div>
  );
}
