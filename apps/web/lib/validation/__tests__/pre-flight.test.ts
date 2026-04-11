import { describe, expect, it } from "vitest";
import type { ProgramSchema } from "@flowos/schema";
import { getDefaultModelForProvider, validatePreFlight } from "../pre-flight";

function makeSchema(overrides?: Partial<ProgramSchema>): ProgramSchema {
  const base: ProgramSchema = {
    version: "1.0",
    program_id: "prog-preflight",
    program_name: "Preflight Test",
    created_at: "2026-04-12T00:00:00.000Z",
    updated_at: "2026-04-12T00:00:00.000Z",
    execution_mode: "supervised",
    nodes: [
      {
        id: "n1",
        type: "trigger",
        label: "Manual trigger",
        description: "Start manually",
        position: { x: 100, y: 100 },
        status: "idle",
        connection: null,
        config: { trigger_type: "manual" },
      },
      {
        id: "n2",
        type: "agent",
        label: "Agent",
        description: "Summarize",
        position: { x: 300, y: 100 },
        status: "idle",
        connection: null,
        config: {
          model: "__USER_ASSIGNED__",
          api_key_ref: "__USER_ASSIGNED__",
          system_prompt: "summarize",
          input_schema: null,
          output_schema: null,
          requires_approval: false,
          approval_timeout_hours: 24,
          scope_required: null,
          scope_access: "read",
          retry: {
            max_attempts: 3,
            backoff: "exponential",
            backoff_base_seconds: 5,
            fail_program_on_exhaust: false,
          },
          tools: [],
        },
      },
    ],
    edges: [
      {
        id: "e1",
        from: "n1",
        to: "n2",
        type: "data_flow",
        data_mapping: null,
        condition: null,
        label: null,
      },
    ],
    triggers: [
      {
        node_id: "n1",
        type: "manual",
        is_active: false,
        last_fired: null,
        next_scheduled: null,
      },
    ],
    version_history: [],
    metadata: {
      description: "test",
      genesis_model: "test-model",
      genesis_timestamp: "2026-04-12T00:00:00.000Z",
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

describe("pre-flight remediations", () => {
  it("suggests assign_agent_defaults for unassigned agent nodes when a valid key exists", async () => {
    const schema = makeSchema();

    const { checks } = await validatePreFlight(schema, [], [
      { id: "key-1", name: "Primary", provider: "openai", is_valid: true },
    ]);

    const unassignedCheck = checks.find((check) => check.code === "PRE_004");
    expect(unassignedCheck?.status).toBe("fail");
    expect(unassignedCheck?.failures[0]?.remediation).toEqual({
      type: "assign_agent_defaults",
      label: "Auto-assign model and API key",
      node_id: "n2",
    });
  });

  it("falls back to navigate remediation when no valid API key is available", async () => {
    const schema = makeSchema();

    const { checks } = await validatePreFlight(schema, [], [
      { id: "key-1", name: "Old", provider: "openai", is_valid: false },
    ]);

    const unassignedCheck = checks.find((check) => check.code === "PRE_004");
    expect(unassignedCheck?.status).toBe("fail");
    expect(unassignedCheck?.failures[0]?.remediation).toEqual({
      type: "navigate",
      label: "Manage API keys",
      href: "/api-keys",
    });
  });

  it("flags broken graph links with removable edge remediation", async () => {
    const schema = makeSchema();
    const agentNode = schema.nodes.find((node) => node.id === "n2");
    if (!agentNode || agentNode.type !== "agent") {
      throw new Error("Expected n2 to be an agent node");
    }

    agentNode.config.model = "gpt-4o-mini";
    agentNode.config.api_key_ref = "key-1";
    schema.edges.push({
      id: "e-bad",
      from: "missing-node",
      to: "n2",
      type: "data_flow",
      data_mapping: null,
      condition: null,
      label: null,
    });

    const { checks } = await validatePreFlight(schema, [], [
      { id: "key-1", name: "Primary", provider: "openai", is_valid: true },
    ]);

    const graphCheck = checks.find((check) => check.code === "PRE_005");
    expect(graphCheck?.status).toBe("fail");
    expect(graphCheck?.failures).toHaveLength(1);
    expect(graphCheck?.failures[0]?.remediation).toEqual({
      type: "remove_invalid_edge",
      label: "Remove invalid edge",
      edge_id: "e-bad",
    });
  });

  it("uses provider defaults for auto-assignment", () => {
    expect(getDefaultModelForProvider("openai")).toBe("gpt-4o");
    expect(getDefaultModelForProvider("unknown-provider")).toBeNull();
  });
});
