import { describe, expect, it } from "vitest";
import { ProgramSchemaZ, type ProgramSchema } from "@flowos/schema";
import {
  buildDraftCompletenessPreFlight,
  getDefaultModelForProvider,
  validatePreFlight,
} from "../pre-flight";

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

const gmailConnection = {
  id: "conn-1",
  name: "gmail:primary",
  provider: "gmail",
  scopes: [] as string[],
  is_valid: true,
};
const validKey = { id: "key-1", name: "Primary", provider: "openai", is_valid: true };

// A connection node with no operation at all — the shape Genesis produced when
// a weak model emitted `operation: null` and normalizeSchema deleted the null.
function withOperationlessConnectionNode(scopeAccess: "read" | "write"): ProgramSchema {
  const schema = makeSchema();
  const agentNode = schema.nodes.find((node) => node.id === "n2");
  if (!agentNode || agentNode.type !== "agent") throw new Error("Expected n2 to be an agent node");
  agentNode.config.model = "gpt-4o-mini";
  agentNode.config.api_key_ref = "key-1";
  schema.nodes.push({
    id: "n3",
    type: "connection",
    label: "Apply label",
    description: "Applies the receipts label",
    position: { x: 500, y: 100 },
    status: "idle",
    connection: "gmail:primary",
    config: { provider: "gmail", scope_access: scopeAccess, scope_required: [] },
  });
  schema.edges.push({
    id: "e2",
    from: "n2",
    to: "n3",
    type: "data_flow",
    data_mapping: null,
    condition: null,
    label: null,
  });
  return schema;
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

  it("fails PRE_004 for a write-scoped connection node with no operation", async () => {
    const schema = withOperationlessConnectionNode("write");

    const { result, checks } = await validatePreFlight(schema, [gmailConnection], [validKey]);

    const check = checks.find((c) => c.code === "PRE_004");
    expect(check?.status).toBe("fail");
    expect(check?.failures[0]?.node_id).toBe("n3");
    expect(check?.failures[0]?.message).toContain("no operation selected");
    expect(result.valid).toBe(false);
    expect(result.node_states.n3).toBe("error");
  });

  it("allows a read-scoped connection node with no operation (auth-only pass-through)", async () => {
    const schema = withOperationlessConnectionNode("read");

    const { result } = await validatePreFlight(schema, [gmailConnection], [validKey]);

    expect(result.valid).toBe(true);
  });

  it("turns executable-schema failures into node-specific draft failures", () => {
    const schema = makeSchema();
    schema.nodes[1] = {
      id: "n2",
      type: "step",
      label: "Spam branch",
      description: "Routes email to deletion if classified as spam.",
      position: { x: 300, y: 100 },
      status: "idle",
      connection: null,
      config: {
        logic_type: "branch",
        conditions: [],
        default_branch: "",
      },
    };

    const parsed = ProgramSchemaZ.safeParse(schema);
    expect(parsed.success).toBe(false);
    if (parsed.success) throw new Error("Expected schema to fail executable validation");

    const { result, checks } = buildDraftCompletenessPreFlight(schema, parsed.error);

    expect(result.valid).toBe(false);
    expect(result.node_states.n2).toBe("error");
    expect(checks[0]?.label).toBe("Draft completeness");
    expect(checks[0]?.failures.map((failure) => failure.message)).toEqual([
      "Spam branch needs at least one branch condition.",
      "Spam branch is missing a default branch.",
    ]);
  });

  it("points draft completeness failures at incomplete HTTP nodes", () => {
    const schema = makeSchema();
    schema.nodes[1] = {
      id: "n2",
      type: "connection",
      label: "Delete email",
      description: "Permanently deletes each spam email.",
      position: { x: 300, y: 100 },
      status: "idle",
      connection: null,
      config: {
        connector_type: "http",
        method: "DELETE",
        url: "",
        auth_type: "none",
        auth_value: null,
        query_params: [],
        headers: [],
        body: null,
        parse_response: true,
        timeout_seconds: null,
        retry: null,
      },
    };

    const parsed = ProgramSchemaZ.safeParse(schema);
    expect(parsed.success).toBe(false);
    if (parsed.success) throw new Error("Expected schema to fail executable validation");

    const { result, checks } = buildDraftCompletenessPreFlight(schema, parsed.error);

    expect(result.node_states.n2).toBe("error");
    expect(checks[0]?.failures[0]).toMatchObject({
      node_id: "n2",
      message: "Delete email is missing the HTTP URL.",
      fix_suggestion: "Open Delete email and enter the endpoint URL to call.",
    });
  });

  it("flags a gmail label_email node that has no label to add or remove", async () => {
    const schema = makeSchema({
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
          type: "connection",
          label: "Label email",
          description: "Labels each email.",
          position: { x: 300, y: 100 },
          status: "idle",
          connection: "Gmail",
          config: {
            connector_type: "oauth",
            provider: "gmail",
            operation: "label_email",
            operation_params: { message_id: "{{n1.message_id}}" },
            scope_access: "write",
            scope_required: ["https://www.googleapis.com/auth/gmail.modify"],
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
    });

    const { result, checks } = await validatePreFlight(
      schema,
      [
        {
          id: "conn-1",
          name: "Gmail",
          provider: "gmail",
          scopes: ["https://www.googleapis.com/auth/gmail.modify"],
          is_valid: true,
        },
      ],
      []
    );

    const unassignedCheck = checks.find((check) => check.code === "PRE_004");
    expect(unassignedCheck?.status).toBe("fail");
    expect(unassignedCheck?.failures.map((failure) => failure.message)).toContain(
      "Label email needs a label to add or remove"
    );
    expect(result.node_states.n2).toBe("error");
  });

  it("accepts a gmail label_email node once a label is set", async () => {
    const schema = makeSchema({
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
          type: "connection",
          label: "Label email",
          description: "Labels each email.",
          position: { x: 300, y: 100 },
          status: "idle",
          connection: "Gmail",
          config: {
            connector_type: "oauth",
            provider: "gmail",
            operation: "label_email",
            operation_params: { message_id: "{{n1.message_id}}", add_label_ids: ["Processed"] },
            scope_access: "write",
            scope_required: ["https://www.googleapis.com/auth/gmail.modify"],
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
    });

    const { checks } = await validatePreFlight(
      schema,
      [
        {
          id: "conn-1",
          name: "Gmail",
          provider: "gmail",
          scopes: ["https://www.googleapis.com/auth/gmail.modify"],
          is_valid: true,
        },
      ],
      []
    );

    const unassignedCheck = checks.find((check) => check.code === "PRE_004");
    expect(unassignedCheck?.status).toBe("pass");
  });

  it("uses provider defaults for auto-assignment", () => {
    expect(getDefaultModelForProvider("openai")).toBe("gpt-4o");
    expect(getDefaultModelForProvider("unknown-provider")).toBeNull();
  });
});
