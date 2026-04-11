import { NextResponse } from "next/server";
import { apiError, createServiceClient } from "@/lib/api";
import { createServerClient } from "@/lib/supabase/server";

/**
 * POST /api/programs/[id]/publish
 *
 * Toggles a program's public visibility.
 *
 * Body:
 * {
 *   publish: boolean,
 *   tags?: string[],           // max 5, each max 32 chars
 *   public_author_name?: string // optional display name, max 64 chars
 * }
 *
 * Rules:
 *  - User must own the program
 *  - To publish: program must have at least one successful run
 *  - Schema is sanitized before being made public (api_key_ref → __USER_ASSIGNED__)
 */
export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiError("Unauthorized", 401);

  const body = await request.json().catch(() => null);
  if (!body || typeof body.publish !== "boolean") {
    return apiError("Missing `publish` boolean in body", 400);
  }

  const { publish, tags, public_author_name } = body as {
    publish: boolean;
    tags?: unknown;
    public_author_name?: unknown;
  };

  // Validate tags
  const normalizedTags: string[] = [];
  if (tags !== undefined) {
    if (!Array.isArray(tags)) return apiError("`tags` must be an array", 400);
    for (const t of tags) {
      if (typeof t !== "string") return apiError("Each tag must be a string", 400);
      const trimmed = t.trim().toLowerCase();
      if (trimmed.length > 32) return apiError("Tags must be 32 chars or less", 400);
      if (trimmed) normalizedTags.push(trimmed);
    }
    if (normalizedTags.length > 5) return apiError("Maximum 5 tags allowed", 400);
  }

  // Validate author name
  let authorName: string | null = null;
  if (public_author_name !== undefined) {
    if (typeof public_author_name !== "string") return apiError("`public_author_name` must be a string", 400);
    authorName = public_author_name.trim().slice(0, 64) || null;
  }

  const db = createServiceClient();

  // Verify ownership
  const { data: program, error: progError } = await db
    .from("programs")
    .select("id, schema, is_public")
    .eq("id", params.id)
    .eq("user_id", user.id)
    .single();

  if (progError || !program) return apiError("Program not found", 404);

  // Gate: must have at least one successful run before publishing
  if (publish) {
    const { count } = await db
      .from("runs")
      .select("id", { count: "exact", head: true })
      .eq("program_id", params.id)
      .eq("status", "completed");

    if (!count || count === 0) {
      return apiError(
        "This program must have at least one successful run before it can be published.",
        422
      );
    }
  }

  // Sanitize schema — replace user-specific credential refs with sentinel values
  const sanitizedSchema = sanitizeSchemaForPublish(program.schema as Record<string, unknown>);

  const now = new Date().toISOString();

  const update: Record<string, unknown> = {
    is_public: publish,
    ...(normalizedTags.length > 0 || tags !== undefined ? { tags: normalizedTags } : {}),
    ...(authorName !== undefined ? { public_author_name: authorName } : {}),
    ...(publish ? { published_at: now } : { published_at: null }),
  };

  // If publishing, write the sanitized schema so public viewers see clean refs
  if (publish) {
    update.schema = sanitizedSchema;
  }

  const { data: updated, error: updateError } = await db
    .from("programs")
    .update(update as never)
    .eq("id", params.id)
    .select("id, is_public, tags, fork_count, published_at, public_author_name")
    .single();

  if (updateError || !updated) return apiError("Failed to update program", 500);

  return NextResponse.json({ program: updated });
}

// ─── Schema sanitization ──────────────────────────────────────────────────────

/**
 * Strips user-specific credential identifiers from a schema so it is safe
 * to publish. Replaces api_key_ref UUIDs with the __USER_ASSIGNED__ sentinel.
 * Connection names are left intact — users match them to their own connections.
 */
function sanitizeSchemaForPublish(schema: Record<string, unknown>): Record<string, unknown> {
  const nodes = Array.isArray(schema.nodes) ? schema.nodes : [];

  const sanitizedNodes = nodes.map((node: unknown) => {
    if (!node || typeof node !== "object" || Array.isArray(node)) return node;
    const n = node as Record<string, unknown>;
    if (n.type !== "agent") return n;

    const config = n.config && typeof n.config === "object" && !Array.isArray(n.config)
      ? (n.config as Record<string, unknown>)
      : {};

    // Only replace if it looks like a real UUID ref (not already a sentinel)
    const apiKeyRef = config.api_key_ref;
    const sanitizedRef =
      typeof apiKeyRef === "string" && apiKeyRef !== "__USER_ASSIGNED__" && apiKeyRef !== ""
        ? "__USER_ASSIGNED__"
        : apiKeyRef;

    return {
      ...n,
      config: {
        ...config,
        api_key_ref: sanitizedRef,
      },
    };
  });

  return { ...schema, nodes: sanitizedNodes };
}
