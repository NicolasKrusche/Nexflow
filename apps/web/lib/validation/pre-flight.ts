import type {
  ProgramSchema,
  AgentNode,
  ConnectionNode,
  HttpConnectionConfig,
} from "@flowos/schema";
import {
  validatePostGenesis,
  type ValidationResult,
  type ValidationError,
  type ValidationWarning,
  type NodeValidationState,
} from "./index";

// Input types
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

// Agent model defaults for one-click remediations
const MODEL_PRESETS: Record<string, string[]> = {
  anthropic: ["claude-opus-4-6", "claude-sonnet-4-6", "claude-haiku-4-5-20251001"],
  openai: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "o3-mini"],
  openrouter: [
    "nvidia/nemotron-3-super-120b-a12b:free",
    "mistralai/mistral-7b-instruct:free",
    "google/gemini-flash-1.5-8b",
    "deepseek/deepseek-chat",
    "anthropic/claude-haiku-4-5-20251001",
    "openai/gpt-4o-mini",
  ],
  google: ["gemini-2.0-flash", "gemini-1.5-flash", "gemini-1.5-flash-8b", "gemini-1.5-pro"],
  groq: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "mixtral-8x7b-32768", "gemma2-9b-it"],
  mistral: ["mistral-large-latest", "mistral-small-latest", "open-mixtral-8x22b"],
  cohere: ["command-r-plus", "command-r"],
};

export function getDefaultModelForProvider(provider: string): string | null {
  const presets = MODEL_PRESETS[provider] ?? [];
  return presets.length > 0 ? presets[0] : null;
}

// Check summary (for UI display)
export type PreFlightRemediation =
  | { type: "navigate"; label: string; href: string }
  | { type: "assign_agent_defaults"; label: string; node_id: string }
  | { type: "remove_invalid_edge"; label: string; edge_id: string };

export interface PreFlightFailure {
  node_id: string | null;
  message: string;
  fix_suggestion: string;
  remediation?: PreFlightRemediation;
}

export interface PreFlightCheck {
  code: "PRE_001" | "PRE_002" | "PRE_003" | "PRE_004" | "PRE_005";
  label: string;
  status: "pass" | "fail" | "skip";
  failures: PreFlightFailure[];
}

function isHttpConnectionConfig(
  config: ConnectionNode["config"]
): config is HttpConnectionConfig {
  return config.connector_type === "http";
}

export async function validatePreFlight(
  schema: ProgramSchema,
  connections: PreFlightConnection[],
  apiKeys: PreFlightApiKey[]
): Promise<{ result: ValidationResult; checks: PreFlightCheck[] }> {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];
  const validApiKeys = apiKeys.filter((key) => key.is_valid);

  function err(
    code: string,
    node_id: string | null,
    message: string,
    fix_suggestion: string,
    edge_id: string | null = null
  ) {
    errors.push({ code, severity: "blocking", node_id, edge_id, message, fix_suggestion });
  }

  function defaultAgentRemediation(nodeId: string): PreFlightRemediation {
    if (validApiKeys.length === 0) {
      return {
        type: "navigate",
        label: "Manage API keys",
        href: "/api-keys",
      };
    }

    return {
      type: "assign_agent_defaults",
      label: "Auto-assign model and API key",
      node_id: nodeId,
    };
  }

  function recordFailure(
    bucket: PreFlightFailure[],
    params: {
      code: string;
      node_id: string | null;
      message: string;
      fix_suggestion: string;
      remediation?: PreFlightRemediation;
      edge_id?: string | null;
    }
  ) {
    bucket.push({
      node_id: params.node_id,
      message: params.message,
      fix_suggestion: params.fix_suggestion,
      remediation: params.remediation,
    });

    err(
      params.code,
      params.node_id,
      params.message,
      params.fix_suggestion,
      params.edge_id ?? null
    );
  }

  // Collect per-check failures for the UI checklist
  const pre001: PreFlightFailure[] = [];
  const pre002: PreFlightFailure[] = [];
  const pre003: PreFlightFailure[] = [];
  const pre004: PreFlightFailure[] = [];
  const pre005: PreFlightFailure[] = [];

  // Run checks in parallel
  await Promise.all([
    // PRE_001 - OAuth token validity
    (async () => {
      if (connections.length === 0) return;
      for (const conn of connections) {
        if (!conn.is_valid) {
          const msg = `Connection "${conn.name}" is disconnected or expired`;
          const fix = "Go to Connections and re-authenticate this connection";
          recordFailure(pre001, {
            code: "PRE_001",
            node_id: null,
            message: msg,
            fix_suggestion: fix,
            remediation: {
              type: "navigate",
              label: "Go to Connections",
              href: "/connections",
            },
          });
        }
      }
    })(),

    // PRE_002 - API key validity for any already-assigned keys
    (async () => {
      for (const node of schema.nodes) {
        if (node.type !== "agent") continue;
        const agentNode = node as AgentNode;
        const ref = agentNode.config.api_key_ref;
        if (ref === "__USER_ASSIGNED__") continue; // PRE_004 handles sentinels

        const key = apiKeys.find((candidate) => candidate.id === ref);
        if (!key) {
          const msg = `${node.label} references an API key that no longer exists`;
          const fix = "Open this node and assign a valid API key";
          recordFailure(pre002, {
            code: "PRE_002",
            node_id: node.id,
            message: msg,
            fix_suggestion: fix,
            remediation: defaultAgentRemediation(node.id),
          });
        } else if (!key.is_valid) {
          const msg = `${node.label} uses API key "${key.name}" which is invalid or quota-exhausted`;
          const fix = "Go to API Keys and update or replace this key";
          recordFailure(pre002, {
            code: "PRE_002",
            node_id: node.id,
            message: msg,
            fix_suggestion: fix,
            remediation: defaultAgentRemediation(node.id),
          });
        }
      }
    })(),

    // PRE_003 - Required OAuth scopes granted
    (async () => {
      for (const node of schema.nodes) {
        if (!node.connection) continue;
        const conn = connections.find((candidate) => candidate.name === node.connection);
        if (!conn) continue; // ERR_007 handles missing connection refs

        if (node.type === "agent") {
          const agentNode = node as AgentNode;
          const scopeRequired = agentNode.config.scope_required;
          if (scopeRequired && !(conn.scopes ?? []).includes(scopeRequired)) {
            const msg = `${node.label} requires the "${scopeRequired}" permission but it was not granted for ${conn.name}`;
            const fix = "Re-authenticate this connection and grant the required permission";
            recordFailure(pre003, {
              code: "PRE_003",
              node_id: node.id,
              message: msg,
              fix_suggestion: fix,
              remediation: {
                type: "navigate",
                label: "Go to Connections",
                href: "/connections",
              },
            });
          }
        }

        if (node.type === "connection") {
          const connNode = node as ConnectionNode;
          if (isHttpConnectionConfig(connNode.config)) continue;

          for (const scope of connNode.config.scope_required ?? []) {
            if (!(conn.scopes ?? []).includes(scope)) {
              const msg = `${node.label} requires the "${scope}" permission but it was not granted`;
              const fix = "Re-authenticate this connection and grant the required permission";
              recordFailure(pre003, {
                code: "PRE_003",
                node_id: node.id,
                message: msg,
                fix_suggestion: fix,
                remediation: {
                  type: "navigate",
                  label: "Go to Connections",
                  href: "/connections",
                },
              });
            }
          }
        }
      }
    })(),

    // PRE_004 - Sentinel values still present at execution time
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
          recordFailure(pre004, {
            code: "PRE_004",
            node_id: node.id,
            message: msg,
            fix_suggestion: fix,
            remediation: defaultAgentRemediation(node.id),
          });
        }
      }
    })(),

    // PRE_005 - Broken graph links (invalid edge source/target references)
    (async () => {
      const graphValidation = validatePostGenesis(
        schema,
        connections.map((conn) => ({
          id: conn.id,
          name: conn.name,
          provider: conn.provider,
          scopes: conn.scopes,
        }))
      );

      const invalidEdgeErrors = graphValidation.errors.filter(
        (validationError) =>
          validationError.code === "ERR_004" &&
          typeof validationError.edge_id === "string"
      );

      const seenEdgeIds = new Set<string>();
      for (const issue of invalidEdgeErrors) {
        const edgeId = issue.edge_id as string;
        if (seenEdgeIds.has(edgeId)) continue;
        seenEdgeIds.add(edgeId);

        const fix = "Remove this invalid edge and redraw it between existing nodes";
        recordFailure(pre005, {
          code: "PRE_005",
          node_id: null,
          edge_id: edgeId,
          message: issue.message,
          fix_suggestion: fix,
          remediation: {
            type: "remove_invalid_edge",
            label: "Remove invalid edge",
            edge_id: edgeId,
          },
        });
      }
    })(),
  ]);

  // Build node_states
  const node_states: Record<string, NodeValidationState> = {};
  schema.nodes.forEach((node) => {
    const hasError = errors.some((error) => error.node_id === node.id);
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

  // Build per-check summary for UI display
  const noConnections = connections.length === 0;
  const noAssignedKeys = schema.nodes
    .filter((node) => node.type === "agent")
    .every((node) => (node as AgentNode).config.api_key_ref === "__USER_ASSIGNED__");

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
    {
      code: "PRE_005",
      label: "Graph links",
      status: pre005.length > 0 ? "fail" : "pass",
      failures: pre005,
    },
  ];

  return { result, checks };
}
