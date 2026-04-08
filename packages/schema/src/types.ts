// ─── ROOT ─────────────────────────────────────────────────────────────────

export interface ProgramSchema {
  version: "1.0";
  program_id: string;
  program_name: string;
  created_at: string;          // ISO 8601
  updated_at: string;          // ISO 8601
  execution_mode: ExecutionMode;
  nodes: Node[];
  edges: Edge[];
  triggers: Trigger[];
  version_history: VersionSnapshot[];
  metadata: ProgramMetadata;
}

export type ExecutionMode = "autonomous" | "approval_required" | "supervised";

// ─── METADATA ─────────────────────────────────────────────────────────────

export interface ProgramMetadata {
  description: string;
  genesis_model: string;
  genesis_timestamp: string;   // ISO 8601
  tags: string[];
  is_active: boolean;
  last_run_id: string | null;
  last_run_status: RunStatus | null;
  last_run_timestamp: string | null;
}

export type RunStatus = "success" | "failed" | "partial" | "running" | "waiting_approval";

// ─── NODES ────────────────────────────────────────────────────────────────

export type Node = TriggerNode | AgentNode | StepNode | ConnectionNode;

export interface NodeBase {
  id: string;
  label: string;
  description: string;
  position: { x: number; y: number };
  status: NodeStatus;
}

export type NodeStatus =
  | "idle"
  | "running"
  | "success"
  | "failed"
  | "waiting_approval"
  | "skipped";

// TRIGGER NODE

export interface TriggerNode extends NodeBase {
  type: "trigger";
  connection: string | null;
  config: TriggerConfig;
}

export type TriggerConfig =
  | { trigger_type: "cron"; expression: string; timezone: string }
  | { trigger_type: "event"; source: string; event: string; filter: object | null }
  | { trigger_type: "webhook"; endpoint_id: string; method: "POST" | "GET" }
  | { trigger_type: "manual" }
  | { trigger_type: "program_output"; source_program_id: string; on_status: RunStatus[] };

// AGENT NODE

export interface AgentNode extends NodeBase {
  type: "agent";
  connection: string | null;
  config: AgentConfig;
}

export interface AgentConfig {
  model: string | "__USER_ASSIGNED__";
  api_key_ref: string | "__USER_ASSIGNED__";
  system_prompt: string;
  input_schema: DataSchema | null;
  output_schema: DataSchema | null;
  requires_approval: boolean;
  approval_timeout_hours: number;
  scope_required: string | null;
  scope_access: "read" | "write" | "read_write";
  retry: RetryConfig;
  tools: string[];
}

// STEP NODE

export interface StepNode extends NodeBase {
  type: "step";
  connection: null;
  config: StepConfig;
}

export type StepConfig =
  | {
      logic_type: "transform";
      transformation: string;
      input_schema: DataSchema | null;
      output_schema: DataSchema | null;
    }
  | { logic_type: "filter"; condition: string; pass_schema: DataSchema | null }
  | { logic_type: "branch"; conditions: BranchCondition[]; default_branch: string };

export interface BranchCondition {
  condition: string;
  target_node_id: string;
}

// CONNECTION NODE

export interface KeyValuePair {
  key: string;
  value: string;
}

export interface OAuthConnectionConfig {
  // Optional for backward compatibility with existing schemas that
  // predate connector_type.
  connector_type?: "oauth";
  scope_access: "read" | "write" | "read_write";
  scope_required: string[];
}

export type HttpAuthType =
  | "none"
  | "bearer"
  | "basic"
  | "api_key_header"
  | "api_key_query";

export interface HttpConnectionConfig {
  connector_type: "http";
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";
  url: string;
  auth_type: HttpAuthType;
  // Token / key / or "username:password" for basic auth.
  auth_value: string | null;
  query_params: KeyValuePair[];
  headers: KeyValuePair[];
  body: string | null;
  parse_response: boolean;
  timeout_seconds: number | null;
  retry: RetryConfig | null;
}

export type ConnectionConfig = OAuthConnectionConfig | HttpConnectionConfig;

export interface ConnectionNode extends NodeBase {
  type: "connection";
  // OAuth connectors point to a named connected app; HTTP connectors can be null.
  connection: string | null;
  config: ConnectionConfig;
}

// ─── EDGES ────────────────────────────────────────────────────────────────

export interface Edge {
  id: string;
  from: string;
  to: string;
  type: EdgeType;
  data_mapping: DataMapping | null;
  condition: string | null;
  label: string | null;
}

export type EdgeType = "data_flow" | "control_flow" | "event_subscription";

export interface DataMapping {
  [sourceField: string]: string;
}

// ─── SHARED TYPES ─────────────────────────────────────────────────────────

export interface DataSchema {
  type: "object" | "string" | "number" | "boolean" | "array";
  properties?: { [key: string]: DataSchema };
  items?: DataSchema;
  required?: string[];
}

export interface RetryConfig {
  max_attempts: number;        // 1–5
  backoff: "none" | "linear" | "exponential";
  backoff_base_seconds: number;
  fail_program_on_exhaust: boolean;
}

// ─── TRIGGERS ─────────────────────────────────────────────────────────────

export interface Trigger {
  node_id: string;
  type: TriggerConfig["trigger_type"];
  is_active: boolean;
  last_fired: string | null;
  next_scheduled: string | null;
}

// ─── VERSION HISTORY ──────────────────────────────────────────────────────

export interface VersionSnapshot {
  version_number: number;
  timestamp: string;           // ISO 8601
  changed_by: "genesis" | "user" | "system";
  change_summary: string;
  snapshot: {
    nodes: Node[];
    edges: Edge[];
    triggers: Trigger[];
  };
}
