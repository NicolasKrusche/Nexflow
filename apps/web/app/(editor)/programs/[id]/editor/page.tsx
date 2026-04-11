import { notFound, redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { ProgramSchemaZ } from "@flowos/schema";
import type { ProgramSchema } from "@flowos/schema";
import { validatePostGenesis } from "@/lib/validation";
import { EditorShell } from "@/components/editor/EditorShell";
import type { ApiKey } from "@/components/sidebars/NodeSidebar";

export default async function EditorPage({
  params,
}: {
  params: { id: string };
}) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  // ── Fetch program ─────────────────────────────────────────────────────────
  // Cast through unknown to handle Supabase's generated `never` return type
  // for tables that are not fully reflected in the generated types.

  type ProgramRow = { id: string; name: string; schema: unknown };

  const { data: rawProgram, error: programError } = await supabase
    .from("programs")
    .select("id, name, schema")
    .eq("id", params.id)
    .eq("user_id", user.id)
    .single();

  if (programError || !rawProgram) return notFound();

  const program = rawProgram as unknown as ProgramRow;

  // ── Parse and validate schema ─────────────────────────────────────────────

  const schemaParse = ProgramSchemaZ.safeParse(program.schema);
  if (!schemaParse.success) {
    // Schema is corrupted or not yet generated
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center space-y-2">
          <p className="text-sm font-medium text-foreground">
            This program does not have a valid schema yet.
          </p>
          <p className="text-xs text-muted-foreground">
            Generate a program first, then open the editor.
          </p>
        </div>
      </div>
    );
  }

  // Cast through unknown to reconcile Zod output type with ProgramSchema.
  // The discrepancy is in DataSchema.properties (Record<string,unknown> vs
  // {[key:string]:DataSchema}) — at runtime they are identical.
  const parsedSchema = schemaParse.data as unknown as ProgramSchema;

  // ── Fetch API keys (id, name, provider only — no vault_secret_id) ─────────

  type ApiKeyRow = { id: string; name: string; provider: string };

  const { data: rawApiKeys } = await supabase
    .from("api_keys")
    .select("id, name, provider")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  const apiKeys: ApiKey[] = ((rawApiKeys as unknown as ApiKeyRow[]) ?? []).map(
    (k) => ({
      id: k.id,
      name: k.name,
      provider: k.provider,
    })
  );

  // ── Fetch connections linked to this program ──────────────────────────────

  type LinkedConnectionRow = { connections: { id: string; name: string; provider: string; scopes: string[] | null } };

  const { data: rawLinkedConns } = await supabase
    .from("program_connections")
    .select("connections(id, name, provider, scopes)")
    .eq("program_id", program.id);

  const linkedConnections = ((rawLinkedConns as unknown as LinkedConnectionRow[]) ?? [])
    .map((r) => r.connections)
    .filter(Boolean)
    .map((c) => ({ id: c.id, name: c.name, provider: c.provider, scopes: c.scopes ?? [] }));

  // ── Fetch all user connections (for sidebar dropdown) ────────────────────

  type ConnectionRow = { id: string; name: string; provider: string; scopes: string[] | null };

  const { data: rawAllConns } = await supabase
    .from("connections")
    .select("id, name, provider, scopes")
    .eq("user_id", user.id)
    .order("name", { ascending: true });

  const allConnections = ((rawAllConns as unknown as ConnectionRow[]) ?? [])
    .map((c) => ({ id: c.id, name: c.name, provider: c.provider, scopes: c.scopes ?? [] }));

  // ── Run post-genesis validation ───────────────────────────────────────────

  const initialValidation = validatePostGenesis(parsedSchema, linkedConnections);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <EditorShell
      programId={program.id}
      initialSchema={parsedSchema}
      initialValidation={initialValidation}
      apiKeys={apiKeys}
      linkedConnections={linkedConnections}
      allConnections={allConnections}
    />
  );
}
