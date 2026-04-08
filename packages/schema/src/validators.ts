import { z } from "zod";

// ─── SHARED ───────────────────────────────────────────────────────────────

export const DataSchemaZ: z.ZodType<{
  type: "object" | "string" | "number" | "boolean" | "array";
  properties?: Record<string, unknown>;
  items?: unknown;
  required?: string[];
}> = z.lazy(() =>
  z.object({
    type: z.enum(["object", "string", "number", "boolean", "array"]),
    properties: z.record(DataSchemaZ).optional(),
    items: DataSchemaZ.optional(),
    required: z.array(z.string()).optional(),
  })
);

export const RetryConfigZ = z.object({
  max_attempts: z.number().int().min(1).max(5),
  backoff: z.enum(["none", "linear", "exponential"]),
  backoff_base_seconds: z.number().min(0),
  fail_program_on_exhaust: z.boolean(),
});

// ─── NODE STATUS ──────────────────────────────────────────────────────────

export const NodeStatusZ = z.enum([
  "idle",
  "running",
  "success",
  "failed",
  "waiting_approval",
  "skipped",
]);

export const RunStatusZ = z.enum([
  "success",
  "failed",
  "partial",
  "running",
  "waiting_approval",
]);

// ─── TRIGGER CONFIG ───────────────────────────────────────────────────────

export const TriggerConfigZ = z.discriminatedUnion("trigger_type", [
  z.object({
    trigger_type: z.literal("cron"),
    expression: z.string().min(1),
    timezone: z.string().min(1),
  }),
  z.object({
    trigger_type: z.literal("event"),
    source: z.string().min(1),
    event: z.string().min(1),
    filter: z.record(z.unknown()).nullable(),
  }),
  z.object({
    trigger_type: z.literal("webhook"),
    endpoint_id: z.string().min(1),
    method: z.enum(["POST", "GET"]),
  }),
  z.object({
    trigger_type: z.literal("manual"),
  }),
  z.object({
    trigger_type: z.literal("program_output"),
    source_program_id: z.string().min(1),
    on_status: z.array(RunStatusZ).min(1),
  }),
]);

// ─── NODE BASE ────────────────────────────────────────────────────────────

const NodeBaseZ = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  description: z.string(),
  position: z.object({ x: z.number(), y: z.number() }),
  status: NodeStatusZ,
});

// ─── TRIGGER NODE ─────────────────────────────────────────────────────────

export const TriggerNodeZ = NodeBaseZ.extend({
  type: z.literal("trigger"),
  connection: z.string().nullable(),
  config: TriggerConfigZ,
});

// ─── AGENT NODE ───────────────────────────────────────────────────────────

export const AgentConfigZ = z.object({
  model: z.string().min(1),
  api_key_ref: z.string().min(1),
  system_prompt: z.string(),
  input_schema: DataSchemaZ.nullable(),
  output_schema: DataSchemaZ.nullable(),
  requires_approval: z.boolean(),
  approval_timeout_hours: z.number().min(0),
  scope_required: z.string().nullable(),
  scope_access: z.enum(["read", "write", "read_write"]),
  retry: RetryConfigZ,
  tools: z.array(z.string()),
});

export const AgentNodeZ = NodeBaseZ.extend({
  type: z.literal("agent"),
  connection: z.string().nullable(),
  config: AgentConfigZ,
});

// ─── STEP NODE ────────────────────────────────────────────────────────────

export const StepConfigZ = z.discriminatedUnion("logic_type", [
  z.object({
    logic_type: z.literal("transform"),
    transformation: z.string().min(1),
    input_schema: DataSchemaZ.nullable(),
    output_schema: DataSchemaZ.nullable(),
  }),
  z.object({
    logic_type: z.literal("filter"),
    condition: z.string().min(1),
    pass_schema: DataSchemaZ.nullable(),
  }),
  z.object({
    logic_type: z.literal("branch"),
    conditions: z
      .array(z.object({ condition: z.string().min(1), target_node_id: z.string().min(1) }))
      .min(1),
    default_branch: z.string().min(1),
  }),
  z.object({
    logic_type: z.literal("delay"),
    seconds: z.number().min(0),
  }),
  z.object({
    logic_type: z.literal("loop"),
    over: z.string().min(1),
    item_var: z.string().min(1),
  }),
  z.object({
    logic_type: z.literal("format"),
    template: z.string().min(1),
    output_key: z.string().min(1),
  }),
  z.object({
    logic_type: z.literal("parse"),
    input_key: z.string().min(1),
    format: z.enum(["json", "csv", "lines"]),
  }),
  z.object({
    logic_type: z.literal("deduplicate"),
    key: z.string().min(1),
  }),
  z.object({
    logic_type: z.literal("sort"),
    key: z.string().min(1),
    order: z.enum(["asc", "desc"]),
  }),
]);

export const StepNodeZ = NodeBaseZ.extend({
  type: z.literal("step"),
  connection: z.null(),
  config: StepConfigZ,
});

// ─── CONNECTION NODE ──────────────────────────────────────────────────────

export const ConnectionNodeZ = NodeBaseZ.extend({
  type: z.literal("connection"),
  connection: z.string().nullable(),
  config: z.union([
    z.object({
      // Optional for backward compatibility with older schemas.
      connector_type: z.literal("oauth").optional(),
      scope_access: z.enum(["read", "write", "read_write"]),
      scope_required: z.array(z.string()),
      operation: z.string().optional(),
      operation_params: z.record(z.unknown()).optional(),
    }),
    z.object({
      connector_type: z.literal("http"),
      method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]),
      url: z.string().min(1),
      auth_type: z.enum(["none", "bearer", "basic", "api_key_header", "api_key_query"]),
      auth_value: z.string().nullable(),
      query_params: z.array(z.object({ key: z.string(), value: z.string() })),
      headers: z.array(z.object({ key: z.string(), value: z.string() })),
      body: z.string().nullable(),
      parse_response: z.boolean(),
      timeout_seconds: z.number().positive().nullable(),
      retry: RetryConfigZ.nullable(),
    }),
  ]),
});

// ─── NODES UNION ──────────────────────────────────────────────────────────

export const NodeZ = z.discriminatedUnion("type", [
  TriggerNodeZ,
  AgentNodeZ,
  StepNodeZ,
  ConnectionNodeZ,
]);

// ─── EDGES ────────────────────────────────────────────────────────────────

export const EdgeZ = z.object({
  id: z.string().min(1),
  from: z.string().min(1),
  to: z.string().min(1),
  type: z.enum(["data_flow", "control_flow", "event_subscription"]),
  data_mapping: z.record(z.string()).nullable(),
  condition: z.string().nullable(),
  label: z.string().nullable(),
});

// ─── TRIGGER INDEX ────────────────────────────────────────────────────────

export const TriggerZ = z.object({
  node_id: z.string().min(1),
  type: z.enum(["cron", "event", "webhook", "manual", "program_output"]),
  is_active: z.boolean(),
  last_fired: z.string().nullable(),
  next_scheduled: z.string().nullable(),
});

// ─── VERSION SNAPSHOT ─────────────────────────────────────────────────────

export const VersionSnapshotZ = z.object({
  version_number: z.number().int().min(0),
  timestamp: z.string().min(1),
  changed_by: z.enum(["genesis", "user", "system"]),
  change_summary: z.string(),
  snapshot: z.object({
    nodes: z.array(NodeZ),
    edges: z.array(EdgeZ),
    triggers: z.array(TriggerZ),
  }),
});

// ─── METADATA ─────────────────────────────────────────────────────────────

export const ProgramMetadataZ = z.object({
  description: z.string(),
  genesis_model: z.string(),
  genesis_timestamp: z.string(),
  tags: z.array(z.string()),
  is_active: z.boolean(),
  last_run_id: z.string().nullable(),
  last_run_status: RunStatusZ.nullable(),
  last_run_timestamp: z.string().nullable(),
});

// ─── PROGRAM SCHEMA ───────────────────────────────────────────────────────

export const ProgramSchemaZ = z.object({
  version: z.literal("1.0"),
  program_id: z.string().min(1),
  program_name: z.string().min(1),
  created_at: z.string().min(1),
  updated_at: z.string().min(1),
  execution_mode: z.enum(["autonomous", "approval_required", "supervised"]),
  nodes: z.array(NodeZ),
  edges: z.array(EdgeZ),
  triggers: z.array(TriggerZ),
  version_history: z.array(VersionSnapshotZ),
  metadata: ProgramMetadataZ,
});

export type ProgramSchemaInput = z.input<typeof ProgramSchemaZ>;
export type ProgramSchemaOutput = z.output<typeof ProgramSchemaZ>;
