import type {
  ProgramSchema,
  AgentNode,
  ConnectionNode,
  HttpConnectionConfig,
  OAuthConnectionConfig,
} from "@flowos/schema";
import {
  validatePostGenesis,
  type ValidationResult,
  type ValidationError,
  type ValidationWarning,
  type NodeValidationState,
} from "./index";
import { getMissingRequiredParams, getUnsatisfiedParamGroups } from "@/lib/connectors/operation-params";
import { getDefaultModelForProvider } from "@/lib/model-presets";
import type { z } from "zod";

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

export { getDefaultModelForProvider };

// Check summary (for UI display)
export type PreFlightRemediation =
  | { type: "navigate"; label: string; href: string }
  | { type: "assign_agent_defaults"; label: string; node_id: string }
  | { type: "remove_invalid_edge"; label: string; edge_id: string }
  | { type: "acknowledge_dpa"; label: string; provider_ids: string[] };

export interface PreFlightFailure {
  node_id: string | null;
  message: string;
  fix_suggestion: string;
  remediation?: PreFlightRemediation;
}

export interface PreFlightCheck {
  code: "PRE_001" | "PRE_002" | "PRE_003" | "PRE_004" | "PRE_005" | "PRE_COMPLY";
  label: string;
  status: "pass" | "fail" | "skip";
  failures: PreFlightFailure[];
}

type DraftNodeLike = {
  id?: unknown;
  label?: unknown;
  type?: unknown;
  config?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function humanizeFieldName(value: string): string {
  return value.replace(/_/g, " ");
}

function nodeDisplayName(node: DraftNodeLike | undefined, index: number): string {
  return typeof node?.label === "string" && node.label.trim().length > 0
    ? node.label
    : `Node ${index + 1}`;
}

function formatIssuePath(path: PropertyKey[]): string {
  return path
    .map((part) => humanizeFieldName(String(part)))
    .join(" > ");
}

function describeDraftNodeIssue(
  node: DraftNodeLike | undefined,
  index: number,
  issue: z.ZodIssue
): { message: string; fix_suggestion: string } {
  const label = nodeDisplayName(node, index);
  const tail = issue.path.slice(2).map(String);
  const configPath = tail[0] === "config" ? tail.slice(1) : tail;
  const config = isRecord(node?.config) ? node.config : {};
  const logicType = typeof config.logic_type === "string" ? config.logic_type : null;
  const triggerType = typeof config.trigger_type === "string" ? config.trigger_type : null;
  const isHttp = config.connector_type === "http";
  const field = configPath[0] ?? "configuration";

  if (logicType === "branch" && field === "conditions") {
    return {
      message: `${label} needs at least one branch condition.`,
      fix_suggestion: `Open ${label} and add a condition with its target branch.`,
    };
  }

  if (logicType === "branch" && field === "default_branch") {
    return {
      message: `${label} is missing a default branch.`,
      fix_suggestion: `Open ${label} and choose where items go when no condition matches.`,
    };
  }

  const stepFields: Record<string, string> = {
    transformation: "transformation",
    condition: "filter condition",
    over: "loop input path",
    item_var: "loop item variable",
    template: "format template",
    output_key: "output key",
    input_key: "input key",
    key: "field key",
  };
  if (typeof node?.type === "string" && node.type === "step" && stepFields[field]) {
    const fieldLabel = stepFields[field];
    return {
      message: `${label} is missing its ${fieldLabel}.`,
      fix_suggestion: `Open ${label} and fill in the ${fieldLabel}.`,
    };
  }

  const triggerFields: Record<string, string> = {
    expression: "schedule expression",
    timezone: "timezone",
    source: "event source",
    event: "event name",
    endpoint_id: "webhook endpoint",
    source_program_id: "source program",
    on_status: "status filter",
  };
  if (triggerType && triggerFields[field]) {
    const fieldLabel = triggerFields[field];
    return {
      message: `${label} is missing its ${fieldLabel}.`,
      fix_suggestion: `Open ${label} and fill in the ${fieldLabel}.`,
    };
  }

  if (isHttp && field === "url") {
    return {
      message: `${label} is missing the HTTP URL.`,
      fix_suggestion: `Open ${label} and enter the endpoint URL to call.`,
    };
  }

  const fieldPath = configPath.length > 0 ? formatIssuePath(configPath) : formatIssuePath(tail);
  return {
    message: `${label} has an invalid ${fieldPath || "configuration"}: ${issue.message}`,
    fix_suggestion: `Open ${label} and update ${fieldPath || "the highlighted settings"}.`,
  };
}

export function buildDraftCompletenessPreFlight(
  schema: unknown,
  error: z.ZodError
): { result: ValidationResult; checks: PreFlightCheck[] } {
  const nodes = isRecord(schema) && Array.isArray(schema.nodes)
    ? (schema.nodes as DraftNodeLike[])
    : [];

  const failures: PreFlightFailure[] = [];
  const errors: ValidationError[] = [];
  const node_states: Record<string, NodeValidationState> = {};
  const seen = new Set<string>();

  for (const issue of error.issues) {
    const [scope, rawIndex] = issue.path;
    const index = typeof rawIndex === "number" ? rawIndex : -1;
    const node = scope === "nodes" && index >= 0 ? nodes[index] : undefined;
    const nodeId = typeof node?.id === "string" ? node.id : null;
    const key = `${nodeId ?? "workflow"}:${issue.path.join(".")}:${issue.message}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const details = node
      ? describeDraftNodeIssue(node, index, issue)
      : {
          message: `Workflow draft has an invalid ${formatIssuePath(issue.path)}: ${issue.message}`,
          fix_suggestion: "Review the workflow settings and complete any missing required fields.",
        };

    failures.push({ node_id: nodeId, ...details });
    errors.push({
      code: "PRE_DRAFT",
      severity: "blocking",
      node_id: nodeId,
      edge_id: null,
      ...details,
    });
    if (nodeId) node_states[nodeId] = "error";
  }

  if (failures.length === 0) {
    const fallback = {
      node_id: null,
      message: "This workflow is saved as a draft but is not ready to run.",
      fix_suggestion: "Complete required node fields before validating or running.",
    };
    failures.push(fallback);
    errors.push({
      code: "PRE_DRAFT",
      severity: "blocking",
      edge_id: null,
      ...fallback,
    });
  }

  for (const node of nodes) {
    const nodeId = typeof node.id === "string" ? node.id : null;
    if (nodeId && !node_states[nodeId]) node_states[nodeId] = "valid";
  }

  return {
    result: {
      valid: false,
      errors,
      warnings: [],
      node_states,
    },
    checks: [
      {
        code: "PRE_004",
        label: "Draft completeness",
        status: "fail",
        failures,
      },
    ],
  };
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
        if (ref === "platform") continue; // Corelyx platform key — always valid, no DB row

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
          // File connectors authenticate by device token, not OAuth scopes.
          if (connNode.config.connector_type === "file") continue;

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
        if (node.type === "agent") {
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

        if (node.type === "connection") {
          const connNode = node as ConnectionNode;
          if (connNode.config.connector_type === "http") continue;
          const cfg = connNode.config as OAuthConnectionConfig;
          if (!cfg.operation) {
            // Operation-less connection nodes are legitimate as auth-only
            // pass-throughs, but with write scope the node exists to perform an
            // action — the runtime would silently no-op it and the run would
            // "succeed" without doing its job.
            if (cfg.scope_access === "write" || cfg.scope_access === "read_write") {
              recordFailure(pre004, {
                code: "PRE_004",
                node_id: node.id,
                message: `${node.label} has write access but no operation selected — it would run as a do-nothing step`,
                fix_suggestion: "Open this node in the editor and choose the action it should perform",
              });
            }
            continue;
          }

          const connRow = connections.find((c) => c.name === node.connection);
          const provider = connRow?.provider ?? cfg.provider ?? "";
          if (!provider) continue;

          const missing = getMissingRequiredParams(provider, cfg.operation, cfg.operation_params);
          if (missing.length > 0) {
            const msg = `${node.label} needs ${missing.length === 1 ? "a value" : "values"} for: ${missing.join(", ")}`;
            const fix = "Open this node in the editor and fill the highlighted fields before running";
            recordFailure(pre004, {
              code: "PRE_004",
              node_id: node.id,
              message: msg,
              fix_suggestion: fix,
            });
          }

          const unsatisfiedGroups = getUnsatisfiedParamGroups(
            provider,
            cfg.operation,
            cfg.operation_params
          );
          if (unsatisfiedGroups.length > 0) {
            const msg = `${node.label} needs ${unsatisfiedGroups.join(" and ")}`;
            const fix = "Open this node in the editor and fill the highlighted fields before running";
            recordFailure(pre004, {
              code: "PRE_004",
              node_id: node.id,
              message: msg,
              fix_suggestion: fix,
            });
          }
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
    const isAgentUnassigned =
      node.type === "agent" &&
      ((node as AgentNode).config.model === "__USER_ASSIGNED__" ||
        (node as AgentNode).config.api_key_ref === "__USER_ASSIGNED__");
    const isConnectionUnassigned =
      node.type === "connection" &&
      (() => {
        const rawCfg = (node as ConnectionNode).config;
        if (rawCfg.connector_type === "http") return false;
        const cfg = rawCfg as OAuthConnectionConfig;
        if (!cfg.operation) return false;
        const provider = connections.find((c) => c.name === node.connection)?.provider ?? cfg.provider ?? "";
        if (!provider) return false;
        return (
          getMissingRequiredParams(provider, cfg.operation, cfg.operation_params).length > 0 ||
          getUnsatisfiedParamGroups(provider, cfg.operation, cfg.operation_params).length > 0
        );
      })();

    if (hasError) node_states[node.id] = "error";
    else if (isAgentUnassigned || isConnectionUnassigned) node_states[node.id] = "unassigned";
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
