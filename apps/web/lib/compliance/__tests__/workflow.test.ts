import { describe, expect, it } from "vitest";
import type { ProgramSchema } from "@flowos/schema";
import {
  DEFAULT_WORKSPACE_COMPLIANCE,
  generateComplianceExportReport,
  hasBlockingComplianceChecks,
  validateWorkflowCompliance,
  type ComplianceCheck,
} from "../workflow";

function makeSchema(overrides?: Partial<ProgramSchema>): ProgramSchema {
  const base: ProgramSchema = {
    version: "1.0",
    program_id: "prog-compliance",
    program_name: "Compliance Test",
    created_at: "2026-05-27T00:00:00.000Z",
    updated_at: "2026-05-27T00:00:00.000Z",
    execution_mode: "autonomous",
    nodes: [
      {
        id: "trigger",
        type: "trigger",
        label: "Manual trigger",
        description: "Start manually",
        position: { x: 0, y: 0 },
        status: "idle",
        connection: null,
        config: { trigger_type: "manual" },
      },
      {
        id: "agent",
        type: "agent",
        label: "Draft response",
        description: "Use an LLM",
        position: { x: 220, y: 0 },
        status: "idle",
        connection: null,
        config: {
          model: "gpt-4o-mini",
          api_key_ref: "key-openai",
          system_prompt: "Draft a short response.",
          input_schema: null,
          output_schema: null,
          requires_approval: false,
          approval_timeout_hours: 24,
          scope_required: null,
          scope_access: "read",
          retry: {
            max_attempts: 1,
            backoff: "none",
            backoff_base_seconds: 0,
            fail_program_on_exhaust: false,
          },
          tools: [],
        },
      },
    ],
    edges: [
      {
        id: "edge",
        from: "trigger",
        to: "agent",
        type: "data_flow",
        data_mapping: null,
        condition: null,
        label: null,
      },
    ],
    triggers: [
      {
        node_id: "trigger",
        type: "manual",
        is_active: true,
        last_fired: null,
        next_scheduled: null,
      },
    ],
    version_history: [],
    metadata: {
      description: "test",
      genesis_model: "manual",
      genesis_timestamp: "2026-05-27T00:00:00.000Z",
      tags: [],
      is_active: false,
      last_run_id: null,
      last_run_status: null,
      last_run_timestamp: null,
    },
  };

  return {
    ...base,
    ...overrides,
    nodes: overrides?.nodes ?? base.nodes,
    edges: overrides?.edges ?? base.edges,
    triggers: overrides?.triggers ?? base.triggers,
    version_history: overrides?.version_history ?? base.version_history,
    metadata: overrides?.metadata ?? base.metadata,
  };
}

describe("workflow compliance evidence", () => {
  it("blocks non-approved providers in EU-only mode", () => {
    const base = makeSchema();
    const agent = base.nodes[1];
    if (agent.type !== "agent") throw new Error("Expected agent node");
    const schema = makeSchema({
      nodes: [
        base.nodes[0],
        {
          ...agent,
          config: {
            ...agent.config,
            model: "claude-sonnet-4",
            api_key_ref: "key-anthropic",
          },
        },
      ],
    });

    const checks = validateWorkflowCompliance(
      schema,
      { ...DEFAULT_WORKSPACE_COMPLIANCE, compliance_mode: "eu_only" },
      { apiKeys: [{ id: "key-anthropic", provider: "anthropic", is_valid: true }] }
    );

    expect(checks.find((check) => check.id === "eu-only-mode")?.status).toBe("blocked");
  });

  it("requires human approval gates for high-risk AI workflows", () => {
    const schema = makeSchema({
      metadata: {
        ...makeSchema().metadata,
        ai_act_risk_level: "high_risk",
        reviewer: "Legal Reviewer",
        reviewed_at: "2026-05-27T12:00:00.000Z",
      },
    });

    const checks = validateWorkflowCompliance(
      schema,
      DEFAULT_WORKSPACE_COMPLIANCE,
      { apiKeys: [{ id: "key-openai", provider: "openai", is_valid: true }] }
    );

    expect(checks.find((check) => check.id === "human-approval")?.status).toBe("blocked");
  });

  it("keeps heuristic high-impact findings as warnings — only explicit oversight blocks", () => {
    // Autonomous workflow with an agent node and NO explicit risk classification:
    // the high-impact heuristic counts every agent node, so this must stay a
    // warning or effectively all autonomous workflows would be blocked.
    const checks = validateWorkflowCompliance(
      makeSchema(),
      DEFAULT_WORKSPACE_COMPLIANCE,
      { apiKeys: [{ id: "key-openai", provider: "openai", is_valid: true }] }
    );

    expect(checks.find((check) => check.id === "human-approval")?.status).toBe("warning");
    expect(hasBlockingComplianceChecks(checks)).toBe(false);
  });

  it("blocks on blocked checks; needs_reviewer blocks only when opted in (publish)", () => {
    const blocked: ComplianceCheck[] = [
      { id: "x", label: "X", status: "blocked", message: "" },
    ];
    const needsReviewer: ComplianceCheck[] = [
      { id: "y", label: "Y", status: "needs_reviewer", message: "" },
    ];

    expect(hasBlockingComplianceChecks(blocked)).toBe(true);
    expect(hasBlockingComplianceChecks(needsReviewer)).toBe(false);
    expect(hasBlockingComplianceChecks(needsReviewer, { includeNeedsReviewer: true })).toBe(true);
  });

  it("generates a compliance export with providers, retention, and audit fields", () => {
    const schema = makeSchema({ execution_mode: "supervised" });

    const report = generateComplianceExportReport({
      schema,
      workspace: { ...DEFAULT_WORKSPACE_COMPLIANCE, compliance_mode: "eu_only" },
      context: { apiKeys: [{ id: "key-openai", provider: "openai", is_valid: true }] },
      program: {
        id: "prog-compliance",
        name: "Compliance Test",
        schema_version: 3,
        ai_act_risk_level: "transparency",
        transparency_notice_required: true,
      },
    });

    expect(report.workflow.version).toBe(3);
    expect(report.workspace.compliance_mode).toBe("eu_only");
    expect(report.providers_and_subprocessors.some((provider) => provider.id === "openai")).toBe(true);
    expect(report.logging.audit_log_fields).toContain("provider_id");
    expect(report.human_approval_gates).toHaveLength(1);
    expect(() => JSON.stringify(report)).not.toThrow();
  });
});
