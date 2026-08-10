import { NextResponse } from "next/server";
import { apiError, createServiceClient } from "@/lib/api";
import { createServerClient } from "@/lib/supabase/server";
import { canEdit, canView, getProgramAccess } from "@/lib/workspaces";
import { isAdminEmail } from "@/lib/admin";
import { ProgramSchemaZ } from "@flowos/schema";
import type { ProgramSchema } from "@flowos/schema";
import {
  loadWorkflowProviderContext,
  loadWorkspaceComplianceSettings,
} from "@/lib/compliance/server";
import {
  hasBlockingComplianceChecks,
  validateWorkflowCompliance,
} from "@/lib/compliance/workflow";

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
  { params: routeParams }: { params: Promise<{ id: string }> }
) {
  const params = await routeParams;
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

  const access = await getProgramAccess(params.id, user.id);
  if (!canView(access)) return apiError("Program not found", 404);
  if (!canEdit(access)) return apiError("Only program editors can publish.", 403);

  const db = createServiceClient();

  const { data: program, error: progError } = await db
    .from("programs")
    .select("id, schema, is_public, workspace_id, schema_version, ai_use_case_category, ai_act_risk_level, customer_role, human_oversight_required, transparency_notice_required, high_risk_documentation_required, prohibited_reason, reviewer, reviewed_at, ai_act_notes, legal_review_override")
    .eq("id", params.id)
    .single();

  if (progError || !program) return apiError("Program not found", 404);

  // Gate: must have at least one successful run before publishing
  if (publish) {
    const userIsAdmin = isAdminEmail(user.email ?? undefined);
    const programForCompliance = program as unknown as {
      schema: unknown;
      workspace_id: string;
      id: string;
      name?: string;
      schema_version: number | null;
      ai_use_case_category: string | null;
      ai_act_risk_level: "prohibited" | "high_risk" | "transparency" | "gpai_related" | "limited_or_minimal" | "unknown";
      customer_role: "provider" | "deployer" | "distributor" | "importer" | "product_manufacturer" | "unknown";
      human_oversight_required: boolean;
      transparency_notice_required: boolean;
      high_risk_documentation_required: boolean;
      prohibited_reason: string | null;
      reviewer: string | null;
      reviewed_at: string | null;
      ai_act_notes: string | null;
      legal_review_override: boolean;
    };
    programForCompliance.legal_review_override =
      programForCompliance.legal_review_override === true && userIsAdmin;
    const parsedSchema = ProgramSchemaZ.safeParse(programForCompliance.schema);
    if (!parsedSchema.success) {
      return NextResponse.json(
        {
          error: "WORKFLOW_NOT_RUNNABLE",
          message: "Complete required node settings before publishing this workflow.",
          details: parsedSchema.error.flatten(),
        },
        { status: 422 }
      );
    }

    const [workspaceCompliance, providerContext] = await Promise.all([
      loadWorkspaceComplianceSettings(programForCompliance.workspace_id, db as never),
      loadWorkflowProviderContext(params.id, programForCompliance.workspace_id, db as never),
    ]);
    const complianceChecks = validateWorkflowCompliance(
      parsedSchema.data as unknown as ProgramSchema,
      workspaceCompliance,
      providerContext,
      programForCompliance
    );
    if (hasBlockingComplianceChecks(complianceChecks, { includeNeedsReviewer: true })) {
      return NextResponse.json(
        {
          error: "COMPLIANCE_CHECKS_FAILED",
          message: "Resolve the blocked or reviewer-required compliance checks before publishing.",
          compliance_checks: complianceChecks,
        },
        { status: 422 }
      );
    }

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

  const now = new Date().toISOString();

  // Publishing only flips visibility — it must not touch the schema. Writing a
  // sanitized copy back over the owner's row replaced their agent nodes'
  // api_key_ref with __USER_ASSIGNED__, which the runtime's preflight rejects
  // as critical (PRE_004), so publishing silently broke the very program that
  // had to run successfully to become publishable — and unpublishing never put
  // it back. Credentials are stripped on the way out instead, when someone
  // else copies the program (see lib/programs/public-schema.ts).
  const update: Record<string, unknown> = {
    is_public: publish,
    ...(normalizedTags.length > 0 || tags !== undefined ? { tags: normalizedTags } : {}),
    ...(authorName !== undefined ? { public_author_name: authorName } : {}),
    ...(publish ? { published_at: now } : { published_at: null }),
  };

  const { data: updated, error: updateError } = await db
    .from("programs")
    .update(update as never)
    .eq("id", params.id)
    .select("id, is_public, tags, fork_count, published_at, public_author_name")
    .single();

  if (updateError || !updated) return apiError("Failed to update program", 500);

  return NextResponse.json({ program: updated });
}

