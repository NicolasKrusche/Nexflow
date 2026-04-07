import { describe, it, expect } from "vitest";
import { toReactFlow, fromReactFlow } from "../index";
import { applyDagreLayout, needsLayout } from "../layout";
import type { ProgramSchema } from "@flowos/schema";

// ─── Helper ───────────────────────────────────────────────────────────────────

/**
 * Deep equality ignoring `updated_at` — fromReactFlow stamps it with the
 * current ISO timestamp, which will always differ.
 */
function schemaEqual(a: ProgramSchema, b: ProgramSchema): boolean {
  return (
    JSON.stringify({ ...a, updated_at: "" }) ===
    JSON.stringify({ ...b, updated_at: "" })
  );
}

/** Run the full roundtrip and return the resulting schema. */
function roundtrip(schema: ProgramSchema): ProgramSchema {
  const { nodes, edges } = toReactFlow(schema, null);
  return fromReactFlow(nodes, edges, schema);
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const BASE_METADATA = {
  description: "Test program",
  genesis_model: "claude-3-5-sonnet-20241022",
  genesis_timestamp: "2026-04-05T12:00:00.000Z",
  tags: ["test"],
  is_active: true,
  last_run_id: null,
  last_run_status: null,
  last_run_timestamp: null,
};

/** 1. Trigger-only schema — 1 node, 0 edges */
const triggerOnlySchema: ProgramSchema = {
  version: "1.0",
  program_id: "prog-001",
  program_name: "Trigger Only",
  created_at: "2026-04-05T12:00:00.000Z",
  updated_at: "2026-04-05T12:00:00.000Z",
  execution_mode: "autonomous",
  nodes: [
    {
      id: "t1",
      type: "trigger",
      label: "Manual Trigger",
      description: "Kicks off the program",
      position: { x: 100, y: 100 },
      status: "idle",
      connection: null,
      config: { trigger_type: "manual" },
    },
  ],
  edges: [],
  triggers: [
    {
      node_id: "t1",
      type: "manual",
      is_active: true,
      last_fired: null,
      next_scheduled: null,
    },
  ],
  version_history: [],
  metadata: BASE_METADATA,
};

/** 2. Two-node schema — trigger + agent, 1 data_flow edge */
const twoNodeSchema: ProgramSchema = {
  version: "1.0",
  program_id: "prog-002",
  program_name: "Trigger + Agent",
  created_at: "2026-04-05T12:00:00.000Z",
  updated_at: "2026-04-05T12:00:00.000Z",
  execution_mode: "autonomous",
  nodes: [
    {
      id: "t1",
      type: "trigger",
      label: "Webhook",
      description: "Incoming webhook",
      position: { x: 50, y: 200 },
      status: "idle",
      connection: null,
      config: {
        trigger_type: "webhook",
        endpoint_id: "ep-abc",
        method: "POST",
      },
    },
    {
      id: "a1",
      type: "agent",
      label: "Summariser",
      description: "Summarises webhook payload",
      position: { x: 350, y: 200 },
      status: "idle",
      connection: null,
      config: {
        model: "claude-3-5-sonnet-20241022",
        api_key_ref: "key-anthropic",
        system_prompt: "Summarise the following payload.",
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
      from: "t1",
      to: "a1",
      type: "data_flow",
      data_mapping: null,
      condition: null,
      label: null,
    },
  ],
  triggers: [
    {
      node_id: "t1",
      type: "webhook",
      is_active: true,
      last_fired: null,
      next_scheduled: null,
    },
  ],
  version_history: [],
  metadata: BASE_METADATA,
};

/** 3. Full schema — trigger + agent + step + connection, 3 different edge types */
const fullSchema: ProgramSchema = {
  version: "1.0",
  program_id: "prog-003",
  program_name: "Full Schema",
  created_at: "2026-04-05T12:00:00.000Z",
  updated_at: "2026-04-05T12:00:00.000Z",
  execution_mode: "approval_required",
  nodes: [
    {
      id: "t1",
      type: "trigger",
      label: "Cron Trigger",
      description: "Fires every morning",
      position: { x: 50, y: 150 },
      status: "idle",
      connection: null,
      config: {
        trigger_type: "cron",
        expression: "0 9 * * 1-5",
        timezone: "America/New_York",
      },
    },
    {
      id: "conn1",
      type: "connection",
      label: "Gmail",
      description: "Gmail read access",
      position: { x: 50, y: 350 },
      status: "idle",
      connection: "cred-gmail-001",
      config: {
        scope_access: "read",
        scope_required: ["https://www.googleapis.com/auth/gmail.readonly"],
      },
    },
    {
      id: "a1",
      type: "agent",
      label: "Email Processor",
      description: "Reads and processes emails",
      position: { x: 350, y: 200 },
      status: "idle",
      connection: null,
      config: {
        model: "claude-3-5-sonnet-20241022",
        api_key_ref: "key-anthropic",
        system_prompt: "Process the emails.",
        input_schema: null,
        output_schema: null,
        requires_approval: true,
        approval_timeout_hours: 48,
        scope_required: "https://www.googleapis.com/auth/gmail.readonly",
        scope_access: "read",
        retry: {
          max_attempts: 2,
          backoff: "linear",
          backoff_base_seconds: 10,
          fail_program_on_exhaust: true,
        },
        tools: ["gmail_read"],
      },
    },
    {
      id: "s1",
      type: "step",
      label: "Format Output",
      description: "Transforms agent output",
      position: { x: 650, y: 200 },
      status: "idle",
      connection: null,
      config: {
        logic_type: "transform",
        transformation: "return { summary: input.content }",
        input_schema: null,
        output_schema: null,
      },
    },
  ],
  edges: [
    {
      id: "e1",
      from: "t1",
      to: "a1",
      type: "control_flow",
      data_mapping: null,
      condition: null,
      label: "start",
    },
    {
      id: "e2",
      from: "conn1",
      to: "a1",
      type: "event_subscription",
      data_mapping: null,
      condition: null,
      label: null,
    },
    {
      id: "e3",
      from: "a1",
      to: "s1",
      type: "data_flow",
      data_mapping: { content: "$.output.text" },
      condition: null,
      label: null,
    },
  ],
  triggers: [
    {
      node_id: "t1",
      type: "cron",
      is_active: true,
      last_fired: "2026-04-04T09:00:00.000Z",
      next_scheduled: "2026-04-07T09:00:00.000Z",
    },
  ],
  version_history: [],
  metadata: BASE_METADATA,
};

/** 4. Agent with sentinel values */
const sentinelSchema: ProgramSchema = {
  version: "1.0",
  program_id: "prog-004",
  program_name: "Sentinel Agent",
  created_at: "2026-04-05T12:00:00.000Z",
  updated_at: "2026-04-05T12:00:00.000Z",
  execution_mode: "autonomous",
  nodes: [
    {
      id: "t1",
      type: "trigger",
      label: "Manual",
      description: "",
      position: { x: 100, y: 100 },
      status: "idle",
      connection: null,
      config: { trigger_type: "manual" },
    },
    {
      id: "a1",
      type: "agent",
      label: "Unassigned Agent",
      description: "Needs model + key",
      position: { x: 400, y: 100 },
      status: "idle",
      connection: null,
      config: {
        model: "__USER_ASSIGNED__",
        api_key_ref: "__USER_ASSIGNED__",
        system_prompt: "",
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
      from: "t1",
      to: "a1",
      type: "data_flow",
      data_mapping: null,
      condition: null,
      label: null,
    },
  ],
  triggers: [
    {
      node_id: "t1",
      type: "manual",
      is_active: true,
      last_fired: null,
      next_scheduled: null,
    },
  ],
  version_history: [],
  metadata: BASE_METADATA,
};

/** 5. Cron trigger config preserved exactly */
const cronSchema: ProgramSchema = {
  version: "1.0",
  program_id: "prog-005",
  program_name: "Cron Trigger",
  created_at: "2026-04-05T12:00:00.000Z",
  updated_at: "2026-04-05T12:00:00.000Z",
  execution_mode: "autonomous",
  nodes: [
    {
      id: "t1",
      type: "trigger",
      label: "Weekday Cron",
      description: "Fires at 9am on weekdays",
      position: { x: 200, y: 200 },
      status: "idle",
      connection: null,
      config: {
        trigger_type: "cron",
        expression: "0 9 * * 1-5",
        timezone: "Europe/London",
      },
    },
  ],
  edges: [],
  triggers: [
    {
      node_id: "t1",
      type: "cron",
      is_active: true,
      last_fired: null,
      next_scheduled: "2026-04-07T09:00:00.000Z",
    },
  ],
  version_history: [],
  metadata: BASE_METADATA,
};

/** 6. Step node with branch logic */
const branchStepSchema: ProgramSchema = {
  version: "1.0",
  program_id: "prog-006",
  program_name: "Branch Step",
  created_at: "2026-04-05T12:00:00.000Z",
  updated_at: "2026-04-05T12:00:00.000Z",
  execution_mode: "autonomous",
  nodes: [
    {
      id: "t1",
      type: "trigger",
      label: "Manual",
      description: "",
      position: { x: 100, y: 200 },
      status: "idle",
      connection: null,
      config: { trigger_type: "manual" },
    },
    {
      id: "s1",
      type: "step",
      label: "Route",
      description: "Routes based on score",
      position: { x: 400, y: 200 },
      status: "idle",
      connection: null,
      config: {
        logic_type: "branch",
        conditions: [
          { condition: "input.score > 80", target_node_id: "a1" },
          { condition: "input.score <= 80", target_node_id: "a2" },
        ],
        default_branch: "a2",
      },
    },
    {
      id: "a1",
      type: "agent",
      label: "High Score Agent",
      description: "",
      position: { x: 700, y: 100 },
      status: "idle",
      connection: null,
      config: {
        model: "claude-3-5-sonnet-20241022",
        api_key_ref: "key-1",
        system_prompt: "Handle high score case.",
        input_schema: null,
        output_schema: null,
        requires_approval: false,
        approval_timeout_hours: 24,
        scope_required: null,
        scope_access: "read",
        retry: {
          max_attempts: 3,
          backoff: "none",
          backoff_base_seconds: 0,
          fail_program_on_exhaust: false,
        },
        tools: [],
      },
    },
    {
      id: "a2",
      type: "agent",
      label: "Low Score Agent",
      description: "",
      position: { x: 700, y: 300 },
      status: "idle",
      connection: null,
      config: {
        model: "claude-3-5-sonnet-20241022",
        api_key_ref: "key-1",
        system_prompt: "Handle low score case.",
        input_schema: null,
        output_schema: null,
        requires_approval: false,
        approval_timeout_hours: 24,
        scope_required: null,
        scope_access: "read",
        retry: {
          max_attempts: 3,
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
      id: "e1",
      from: "t1",
      to: "s1",
      type: "control_flow",
      data_mapping: null,
      condition: null,
      label: null,
    },
    {
      id: "e2",
      from: "s1",
      to: "a1",
      type: "control_flow",
      data_mapping: null,
      condition: "input.score > 80",
      label: "high",
    },
    {
      id: "e3",
      from: "s1",
      to: "a2",
      type: "control_flow",
      data_mapping: null,
      condition: "input.score <= 80",
      label: "low",
    },
  ],
  triggers: [
    {
      node_id: "t1",
      type: "manual",
      is_active: true,
      last_fired: null,
      next_scheduled: null,
    },
  ],
  version_history: [],
  metadata: BASE_METADATA,
};

/** 7. Edge with data_mapping preserved */
const dataMappingSchema: ProgramSchema = {
  version: "1.0",
  program_id: "prog-007",
  program_name: "Data Mapping",
  created_at: "2026-04-05T12:00:00.000Z",
  updated_at: "2026-04-05T12:00:00.000Z",
  execution_mode: "autonomous",
  nodes: [
    {
      id: "t1",
      type: "trigger",
      label: "Event Trigger",
      description: "",
      position: { x: 100, y: 100 },
      status: "idle",
      connection: null,
      config: {
        trigger_type: "event",
        source: "github",
        event: "push",
        filter: { branch: "main" },
      },
    },
    {
      id: "a1",
      type: "agent",
      label: "CI Checker",
      description: "",
      position: { x: 400, y: 100 },
      status: "idle",
      connection: null,
      config: {
        model: "claude-3-5-sonnet-20241022",
        api_key_ref: "key-anthropic",
        system_prompt: "Review the commit.",
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
          fail_program_on_exhaust: true,
        },
        tools: [],
      },
    },
  ],
  edges: [
    {
      id: "e1",
      from: "t1",
      to: "a1",
      type: "data_flow",
      data_mapping: {
        commit_sha: "$.payload.head_commit.id",
        author: "$.payload.head_commit.author.name",
        message: "$.payload.head_commit.message",
      },
      condition: null,
      label: null,
    },
  ],
  triggers: [
    {
      node_id: "t1",
      type: "event",
      is_active: true,
      last_fired: null,
      next_scheduled: null,
    },
  ],
  version_history: [],
  metadata: BASE_METADATA,
};

/** 8. Schema with non-empty version_history */
const versionHistorySchema: ProgramSchema = {
  version: "1.0",
  program_id: "prog-008",
  program_name: "Version History",
  created_at: "2026-04-01T10:00:00.000Z",
  updated_at: "2026-04-05T12:00:00.000Z",
  execution_mode: "autonomous",
  nodes: [
    {
      id: "t1",
      type: "trigger",
      label: "Manual",
      description: "",
      position: { x: 100, y: 100 },
      status: "idle",
      connection: null,
      config: { trigger_type: "manual" },
    },
  ],
  edges: [],
  triggers: [
    {
      node_id: "t1",
      type: "manual",
      is_active: true,
      last_fired: null,
      next_scheduled: null,
    },
  ],
  version_history: [
    {
      version_number: 1,
      timestamp: "2026-04-01T10:00:00.000Z",
      changed_by: "genesis",
      change_summary: "Initial genesis",
      snapshot: {
        nodes: [
          {
            id: "t1",
            type: "trigger",
            label: "Manual",
            description: "",
            position: { x: 100, y: 100 },
            status: "idle",
            connection: null,
            config: { trigger_type: "manual" },
          },
        ],
        edges: [],
        triggers: [
          {
            node_id: "t1",
            type: "manual",
            is_active: true,
            last_fired: null,
            next_scheduled: null,
          },
        ],
      },
    },
  ],
  metadata: BASE_METADATA,
};

/** 9. Schema with rich metadata */
const richMetadataSchema: ProgramSchema = {
  version: "1.0",
  program_id: "prog-009",
  program_name: "Rich Metadata",
  created_at: "2026-04-02T08:00:00.000Z",
  updated_at: "2026-04-05T12:00:00.000Z",
  execution_mode: "supervised",
  nodes: [
    {
      id: "t1",
      type: "trigger",
      label: "Manual",
      description: "",
      position: { x: 100, y: 100 },
      status: "idle",
      connection: null,
      config: { trigger_type: "manual" },
    },
  ],
  edges: [],
  triggers: [
    {
      node_id: "t1",
      type: "manual",
      is_active: false,
      last_fired: "2026-04-04T10:00:00.000Z",
      next_scheduled: null,
    },
  ],
  version_history: [],
  metadata: {
    description: "A program with detailed metadata",
    genesis_model: "claude-3-5-sonnet-20241022",
    genesis_timestamp: "2026-04-02T08:00:00.000Z",
    tags: ["production", "email", "nightly"],
    is_active: false,
    last_run_id: "run-xyz-123",
    last_run_status: "success",
    last_run_timestamp: "2026-04-04T10:05:00.000Z",
  },
};

/** 10. Position fidelity — nodes at non-default positions */
const positionFidelitySchema: ProgramSchema = {
  version: "1.0",
  program_id: "prog-010",
  program_name: "Position Fidelity",
  created_at: "2026-04-05T12:00:00.000Z",
  updated_at: "2026-04-05T12:00:00.000Z",
  execution_mode: "autonomous",
  nodes: [
    {
      id: "t1",
      type: "trigger",
      label: "Manual",
      description: "",
      position: { x: 123, y: 456 },
      status: "idle",
      connection: null,
      config: { trigger_type: "manual" },
    },
    {
      id: "a1",
      type: "agent",
      label: "Agent",
      description: "",
      position: { x: 789, y: 321 },
      status: "idle",
      connection: null,
      config: {
        model: "claude-3-5-sonnet-20241022",
        api_key_ref: "key-1",
        system_prompt: "Do stuff.",
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
      from: "t1",
      to: "a1",
      type: "data_flow",
      data_mapping: null,
      condition: null,
      label: null,
    },
  ],
  triggers: [
    {
      node_id: "t1",
      type: "manual",
      is_active: true,
      last_fired: null,
      next_scheduled: null,
    },
  ],
  version_history: [],
  metadata: BASE_METADATA,
};

// ─── Roundtrip tests ──────────────────────────────────────────────────────────

describe("toReactFlow / fromReactFlow roundtrip", () => {
  it("1. preserves trigger-only schema (1 node, 0 edges)", () => {
    expect(schemaEqual(roundtrip(triggerOnlySchema), triggerOnlySchema)).toBe(true);
  });

  it("2. preserves two-node schema (trigger + agent, 1 data_flow edge)", () => {
    expect(schemaEqual(roundtrip(twoNodeSchema), twoNodeSchema)).toBe(true);
  });

  it("3. preserves full schema (trigger + agent + step + connection, 3 edge types)", () => {
    expect(schemaEqual(roundtrip(fullSchema), fullSchema)).toBe(true);
  });

  it("4. preserves agent sentinel values (__USER_ASSIGNED__)", () => {
    const result = roundtrip(sentinelSchema);
    const agentNode = result.nodes.find((n) => n.id === "a1");
    expect(agentNode?.type).toBe("agent");
    if (agentNode?.type === "agent") {
      expect(agentNode.config.model).toBe("__USER_ASSIGNED__");
      expect(agentNode.config.api_key_ref).toBe("__USER_ASSIGNED__");
    }
    expect(schemaEqual(result, sentinelSchema)).toBe(true);
  });

  it("5. preserves cron trigger config (expression + timezone)", () => {
    const result = roundtrip(cronSchema);
    const triggerNode = result.nodes.find((n) => n.id === "t1");
    expect(triggerNode?.type).toBe("trigger");
    if (triggerNode?.type === "trigger") {
      expect(triggerNode.config.trigger_type).toBe("cron");
      if (triggerNode.config.trigger_type === "cron") {
        expect(triggerNode.config.expression).toBe("0 9 * * 1-5");
        expect(triggerNode.config.timezone).toBe("Europe/London");
      }
    }
    expect(schemaEqual(result, cronSchema)).toBe(true);
  });

  it("6. preserves step node with branch logic (conditions array)", () => {
    const result = roundtrip(branchStepSchema);
    const stepNode = result.nodes.find((n) => n.id === "s1");
    expect(stepNode?.type).toBe("step");
    if (stepNode?.type === "step") {
      expect(stepNode.config.logic_type).toBe("branch");
      if (stepNode.config.logic_type === "branch") {
        expect(stepNode.config.conditions).toHaveLength(2);
        expect(stepNode.config.default_branch).toBe("a2");
      }
    }
    expect(schemaEqual(result, branchStepSchema)).toBe(true);
  });

  it("7. preserves edge data_mapping through roundtrip", () => {
    const result = roundtrip(dataMappingSchema);
    const edge = result.edges.find((e) => e.id === "e1");
    expect(edge?.data_mapping).toEqual({
      commit_sha: "$.payload.head_commit.id",
      author: "$.payload.head_commit.author.name",
      message: "$.payload.head_commit.message",
    });
    expect(schemaEqual(result, dataMappingSchema)).toBe(true);
  });

  it("8. fromReactFlow does not drop version_history", () => {
    const result = roundtrip(versionHistorySchema);
    expect(result.version_history).toHaveLength(1);
    expect(result.version_history[0].version_number).toBe(1);
    expect(result.version_history[0].changed_by).toBe("genesis");
  });

  it("9. fromReactFlow does not drop metadata fields", () => {
    const result = roundtrip(richMetadataSchema);
    expect(result.metadata.last_run_id).toBe("run-xyz-123");
    expect(result.metadata.last_run_status).toBe("success");
    expect(result.metadata.tags).toEqual(["production", "email", "nightly"]);
    expect(result.metadata.is_active).toBe(false);
    expect(result.execution_mode).toBe("supervised");
  });

  it("10. node positions from RF are reflected in output schema", () => {
    const result = roundtrip(positionFidelitySchema);
    const t1 = result.nodes.find((n) => n.id === "t1");
    const a1 = result.nodes.find((n) => n.id === "a1");
    expect(t1?.position).toEqual({ x: 123, y: 456 });
    expect(a1?.position).toEqual({ x: 789, y: 321 });
    expect(schemaEqual(result, positionFidelitySchema)).toBe(true);
  });
});

// ─── applyDagreLayout tests ───────────────────────────────────────────────────

describe("applyDagreLayout", () => {
  /** Build a simple linear chain of RF nodes */
  function makeRFNodes(count: number) {
    return Array.from({ length: count }, (_, i) => ({
      id: `n${i}`,
      type: "step" as const,
      position: { x: 0, y: 0 },
      data: {},
    }));
  }

  function makeRFEdges(count: number) {
    return Array.from({ length: count - 1 }, (_, i) => ({
      id: `e${i}`,
      source: `n${i}`,
      target: `n${i + 1}`,
    }));
  }

  it("output node count matches input node count", () => {
    const nodes = makeRFNodes(5);
    const edges = makeRFEdges(5);
    const result = applyDagreLayout(nodes, edges);
    expect(result).toHaveLength(5);
  });

  it("all output nodes have valid numeric x/y positions", () => {
    const nodes = makeRFNodes(4);
    const edges = makeRFEdges(4);
    const result = applyDagreLayout(nodes, edges);
    for (const n of result) {
      expect(typeof n.position.x).toBe("number");
      expect(typeof n.position.y).toBe("number");
      expect(isNaN(n.position.x)).toBe(false);
      expect(isNaN(n.position.y)).toBe(false);
    }
  });

  it("LR direction produces a layout wider than it is tall for a 4-node chain", () => {
    const nodes = makeRFNodes(4);
    const edges = makeRFEdges(4);
    const result = applyDagreLayout(nodes, edges, "LR");

    const xs = result.map((n) => n.position.x);
    const ys = result.map((n) => n.position.y);
    const width = Math.max(...xs) - Math.min(...xs);
    const height = Math.max(...ys) - Math.min(...ys);

    // For a linear LR chain, the horizontal spread must exceed vertical spread
    expect(width).toBeGreaterThan(height);
  });

  it("needsLayout returns false for a single node", () => {
    const singleNode = makeRFNodes(1);
    expect(needsLayout(singleNode)).toBe(false);
  });

  it("needsLayout returns true when all nodes share the same x position", () => {
    const nodes = makeRFNodes(3).map((n) => ({ ...n, position: { x: 100, y: n.position.y } }));
    expect(needsLayout(nodes)).toBe(true);
  });

  it("needsLayout returns false when nodes have distinct x positions", () => {
    const nodes = [
      { id: "n0", type: "trigger" as const, position: { x: 100, y: 100 }, data: {} },
      { id: "n1", type: "agent" as const, position: { x: 400, y: 200 }, data: {} },
      { id: "n2", type: "step" as const, position: { x: 700, y: 100 }, data: {} },
    ];
    expect(needsLayout(nodes)).toBe(false);
  });
});
