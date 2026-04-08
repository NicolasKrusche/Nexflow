import type {
  ProgramSchema,
  AgentNode,
  ConnectionNode,
  HttpConnectionConfig,
} from "@flowos/schema";
import type { ValidationResult, ValidationError, ValidationWarning, NodeValidationState } from "./index";

// ─── Input types ──────────────────────────────────────────────────────────────

export type PreFlightConnection = {
  id: string;
  name: string;
  provider: string;
  scopes: string[] | null;
  is_valid: boolean;
};

export type PreFlightApiKey = {
  id: string;
  name: string;
  provider: string;
  is_valid: boolean;
};

// ─── Check summary (for UI display) ──────────────────────────────────────────

export interface PreFlightCheck {
  code: "PRE_001" | "PRE_002" | "PRE_003" | "PRE_004";
  label: string;
  status: "pass" | "fail" | "skip";
  failures: Array<{ node_id: string | null; message: string; fix_suggestion: string }>;
}

function isHttpConnectionConfig(
  config: ConnectionNode["config"]
): config is HttpConnectionConfig {
  return config.connector_type === "http";
}

// ─── validatePreFlight ────────────────────────────────────────────────────────

export async function validatePreFlight(
  schema: ProgramSchema,
  connections: PreFlightConnection[],
  apiKeys: PreFlightApiKey[]
): Promise<{ result: ValidationResult; checks: PreFlightCheck[] }> {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  function err(
    code: string,
    node_id: string | null,
    message: string,
    fix_suggestion: string
  ) {
    errors.push({ code, severity: "blocking", node_id, edge_id: null, message, fix_suggestion });
  }

  // Collect per-check failures for the UI checklist
  const pre001: PreFlightCheck["failures"] = [];
  const pre002: PreFlightCheck["failures"] = [];
  const pre003: PreFlightCheck["failures"] = [];
  const pre004: PreFlightCheck["failures"] = [];

  // Run all four checks in parallel
  await Promise.all([

    // PRE_001 — OAuth token validity
    (async () => {
      if (connections.length === 0) return;
      for (const conn of connections) {
        if (!conn.is_valid) {
          const msg = `Connection "${conn.name}" is disconnected or expired`;
          const fix = "Go to Connections and re-authenticate this connection";
          pre001.push({ node_id: null, message: msg, fix_suggestion: fix });
          err("PRE_001", null, msg, fix);
        }
      }
    })(),

    // PRE_002 — API key validity for any already-assigned keys
    (async () => {
      for (const node of schema.nodes) {
        if (node.type !== "agent") continue;
        const agentNode = node as AgentNode;
        const ref = agentNode.config.api_key_ref;
        if (ref === "__USER_ASSIGNED__") continue; // PRE_004 handles sentinels

        const key = apiKeys.find((k) => k.id === ref);
        if (!key) {
          const msg = `${node.label} references an API key that no longer exists`;
          const fix = "Open this node and assign a valid API key";
          pre002.push({ node_id: node.id, message: msg, fix_suggestion: fix });
          err("PRE_002", node.id, msg, fix);
        } else if (!key.is_valid) {
          const msg = `${node.label} uses API key "${key.name}" which is invalid or quota-exhausted`;
          const fix = "Go to API Keys and update or replace this key";
          pre002.push({ node_id: node.id, message: msg, fix_suggestion: fix });
          err("PRE_002", node.id, msg, fix);
        }
      }
    })(),

    // PRE_003 — Required OAuth scopes granted
    (async () => {
      for (const node of schema.nodes) {
        if (!node.connection) continue;
        const conn = connections.find((c) => c.name === node.connection);
        if (!conn) continue; // ERR_007 handles missing connection refs

        if (node.type === "agent") {
          const agentNode = node as AgentNode;
          const scopeRequired = agentNode.config.scope_required;
          if (scopeRequired && !(conn.scopes ?? []).includes(scopeRequired)) {
            const msg = `${node.label} requires the "${scopeRequired}" permission but it was not granted for ${conn.name}`;
            const fix = "Re-authenticate this connection and grant the required permission";
            pre003.push({ node_id: node.id, message: msg, fix_suggestion: fix });
            err("PRE_003", node.id, msg, fix);
          }
        }

        if (node.type === "connection") {
          const connNode = node as ConnectionNode;
          if (isHttpConnectionConfig(connNode.config)) continue;
          for (const scope of connNode.config.scope_required ?? []) {
            if (!(conn.scopes ?? []).includes(scope)) {
              const msg = `${node.label} requires the "${scope}" permission but it was not granted`;
              const fix = "Re-authenticate this connection and grant the required permission";
              pre003.push({ node_id: node.id, message: msg, fix_suggestion: fix });
              err("PRE_003", node.id, msg, fix);
            }
          }
        }
      }
    })(),

    // PRE_004 — Sentinel values still present at execution time
    (async () => {
      for (const node of schema.nodes) {
        if (node.type !== "agent") continue;
        const agentNode = node as AgentNode;
        const hasUnassignedModel = agentNode.config.model === "__USER_ASSIGNED__";
        const hasUnassignedKey = agentNode.config.api_key_ref === "__USER_ASSIGNED__";
        if (hasUnassignedModel || hasUnassignedKey) {
          const what = [
            hasUnassignedModel && "model",
            hasUnassignedKey && "API key",
          ]
            .filter(Boolean)
            .join(" and ");
          const msg = `${node.label} still has an unassigned ${what}`;
          const fix = "Open this node in the editor and assign a model and API key before running";
          pre004.push({ node_id: node.id, message: msg, fix_suggestion: fix });
          err("PRE_004", node.id, msg, fix);
        }
      }
    })(),
  ]);

  // Build node_states
  const node_states: Record<string, NodeValidationState> = {};
  schema.nodes.forEach((node) => {
    const hasError = errors.some((e) => e.node_id === node.id);
    const isUnassigned =
      node.type === "agent" &&
      ((node as AgentNode).config.model === "__USER_ASSIGNED__" ||
        (node as AgentNode).config.api_key_ref === "__USER_ASSIGNED__");
    if (hasError) node_states[node.id] = "error";
    else if (isUnassigned) node_states[node.id] = "unassigned";
    else node_states[node.id] = "valid";
  });

  const result: ValidationResult = {
    valid: errors.length === 0,
    errors,
    warnings,
    node_states,
  };

  // Build the per-check summary for UI display
  const noConnections = connections.length === 0;
  const noAssignedKeys = schema.nodes
    .filter((n) => n.type === "agent")
    .every((n) => (n as AgentNode).config.api_key_ref === "__USER_ASSIGNED__");

  const checks: PreFlightCheck[] = [
    {
      code: "PRE_001",
      label: "OAuth connections",
      status: noConnections ? "skip" : pre001.length > 0 ? "fail" : "pass",
      failures: pre001,
    },
    {
      code: "PRE_002",
      label: "API keys",
      status: noAssignedKeys ? "skip" : pre002.length > 0 ? "fail" : "pass",
      failures: pre002,
    },
    {
      code: "PRE_003",
      label: "Permissions & scopes",
      status: noConnections ? "skip" : pre003.length > 0 ? "fail" : "pass",
      failures: pre003,
    },
    {
      code: "PRE_004",
      label: "Unassigned nodes",
      status: pre004.length > 0 ? "fail" : "pass",
      failures: pre004,
    },
  ];

  return { result, checks };
}
