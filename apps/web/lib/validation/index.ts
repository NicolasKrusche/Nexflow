import type {
  ProgramSchema,
  Node,
  Edge,
  AgentNode,
  StepNode,
  ConnectionNode,
  OAuthConnectionConfig,
} from "@flowos/schema";
import { getMissingRequiredParams } from "@/lib/connectors/operation-params";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
  node_states: Record<string, NodeValidationState>;
}

export interface ValidationError {
  code: string;
  severity: "blocking" | "critical";
  node_id: string | null;
  edge_id: string | null;
  message: string;
  fix_suggestion: string;
}

export interface ValidationWarning {
  code: string;
  node_id: string | null;
  message: string;
  fix_suggestion: string;
}

export type NodeValidationState = "valid" | "error" | "warning" | "unassigned";

type ConnectionRow = {
  id: string;
  name: string;
  provider: string;
  scopes: string[] | null;
};

// ─── Post-Genesis Validation ───────────────────────────────────────────────

export function validatePostGenesis(
  schema: ProgramSchema,
  availableConnections: ConnectionRow[]
): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];
  const nodes = schema.nodes as Node[];
  const edges = schema.edges as Edge[];

  // Note and group nodes are purely visual — exclude them from all execution
  // validation rules so they never cause false errors.
  const execNodes = nodes.filter((n) => n.type !== "note" && n.type !== "group");

  const nodeIds = execNodes.map((n) => n.id);
  const availableConnectionNames = availableConnections.map((c) => c.name);
  const availableConnectionProviders = availableConnections.map((c) => c.provider);

  function error(
    code: string,
    node_id: string | null,
    message: string,
    fix_suggestion: string,
    edge_id: string | null = null
  ) {
    errors.push({ code, severity: "blocking", node_id, edge_id, message, fix_suggestion });
  }

  function warning(code: string, node_id: string | null, message: string, fix_suggestion: string) {
    warnings.push({ code, node_id, message, fix_suggestion });
  }

  // ─── Graph Integrity ───────────────────────────────────────────────────

  const triggerNodes = execNodes.filter((n) => n.type === "trigger");
  if (triggerNodes.length === 0)
    error("ERR_001", null, "Program has no trigger", "Add a trigger node to define when this program starts");

  if (triggerNodes.length > 1)
    error("ERR_002", null, "Program has multiple triggers", "Only one trigger node is allowed. Delete the extra trigger or split into separate programs");

  execNodes.forEach((node) => {
    const connected = edges.some((e) => e.from === node.id || e.to === node.id);
    if (!connected)
      error("ERR_003", node.id, `${node.label} is not connected to anything`, "Draw a connection from this node to another node");
  });

  edges.forEach((edge) => {
    if (!nodeIds.includes(edge.from))
      error("ERR_004", null, `Edge ${edge.id} references missing source node`, "Delete this edge and redraw it from a valid node", edge.id);
    if (!nodeIds.includes(edge.to))
      error("ERR_004", null, `Edge ${edge.id} references missing target node`, "Delete this edge and redraw it to a valid node", edge.id);
  });

  const cycles = detectCycles(execNodes, edges);
  cycles.forEach((cycle) => {
    const hasBranchNode = cycle.some((id) => {
      const node = execNodes.find((n) => n.id === id);
      return node?.type === "step" && (node as StepNode).config.logic_type === "branch";
    });
    if (!hasBranchNode)
      error("ERR_005", null, "Circular connection detected with no exit condition", "Add a branch node with an exit condition to break the loop");
  });

  // (Node-count ceiling removed — programs may contain any number of executable
  // nodes. Note: very large graphs may still be constrained at generation time by
  // the model's output token budget.)

  // ─── Connection References ─────────────────────────────────────────────

  execNodes.forEach((node) => {
    if (!node.connection) return;
    // "corelyx" (and "corelyx:<alias>") is the internal platform reference for
    // account tools like corelyx.report_to_user. It is not a connectable app and
    // has no DB row, but it is always available at runtime — never flag it as a
    // missing connection. (Pre-flight applies the same allowance for the
    // "platform" API-key ref.)
    if (isInternalPlatformRef(node.connection)) return;
    const nameMatch = availableConnectionNames.includes(node.connection);
    // Genesis sometimes generates "provider:alias" style refs (e.g. "sheets:primary")
    // instead of the exact connection name. Accept these when the provider prefix
    // matches a linked connection's provider.
    const providerAliasRegex = /^[\w-]+:[\w-]+$/;
    const providerFromRef = providerAliasRegex.test(node.connection)
      ? node.connection.split(":")[0]!
      : null;
    const providerAliasMatch =
      providerFromRef !== null &&
      availableConnectionProviders.includes(providerFromRef);
    // Also accept when the node's own config specifies a provider (e.g. a
    // palette-created Gmail node with connection set to "My Gmail" whose
    // config.provider is "gmail") and at least one linked connection has
    // that provider.
    const configProviderMatch =
      node.config && typeof node.config === "object" && "provider" in node.config
        ? availableConnectionProviders.includes((node.config as OAuthConnectionConfig).provider ?? "")
        : false;
    if (!nameMatch && !providerAliasMatch && !configProviderMatch)
      error("ERR_007", node.id, `${node.label} uses "${node.connection}" which is not connected to this program`, "Go to program settings and add this connection, or change the node to use an available connection");
  });

  execNodes.forEach((node) => {
    const maybeStep = node as unknown as { id: string; label: string; type?: string; connection?: string | null };
    if (maybeStep.type === "step" && maybeStep.connection != null)
      error("ERR_009", maybeStep.id, `Step node ${maybeStep.label} cannot connect to an external app`, "Step nodes are for logic only. Use an agent node to interact with apps");
  });

  // agent_task is an agent-only node (a bounded autonomous tool-loop). Workflows
  // must never contain one — flag it so it can be removed before publishing.
  if (schema.program_type !== "agent") {
    execNodes.forEach((node) => {
      if (node.type === "agent_task")
        error("ERR_013", node.id, `${node.label} is an Agent Task node, which can only run inside an agent`, "Delete this node — Agent Task steps are not available in workflows");
    });
  }

  // ─── Data Flow ─────────────────────────────────────────────────────────

  edges.forEach((edge) => {
    if (!edge.data_mapping) return;
    const sourceNode = execNodes.find((n) => n.id === edge.from);
    if (!sourceNode) return;
    const config = (sourceNode as AgentNode).config;
    const outputSchema = "output_schema" in config ? config.output_schema : null;
    if (!outputSchema) return;
    Object.keys(edge.data_mapping).forEach((field) => {
      if (!schemaHasField(outputSchema, field))
        error("ERR_010", null, `Edge maps field "${field}" which does not exist in ${sourceNode.label}'s output`, `Remove this mapping or update ${sourceNode.label}'s output schema to include "${field}"`, edge.id);
    });
  });

  // ─── Scope Conflicts ───────────────────────────────────────────────────

  execNodes.forEach((node) => {
    if (!node.connection) return;
    const connection = availableConnections.find((c) => c.name === node.connection);
    if (!connection) return;
    const config = (node as AgentNode).config;
    const scopeAccess = "scope_access" in config ? config.scope_access : null;
    const nodeNeedsWrite = scopeAccess === "write" || scopeAccess === "read_write";
    const scopes = connection.scopes ?? [];
    const programGrantedWrite = scopes.length > 0 && scopes.some((s) => !s.toLowerCase().includes("readonly"));
    if (nodeNeedsWrite && !programGrantedWrite)
      error("ERR_012", node.id, `${node.label} needs write access to ${node.connection} but only read was granted`, "Go to connection settings and grant write permission, or change this node to read-only");
  });

  // ─── Sentinel Warnings ─────────────────────────────────────────────────

  execNodes.forEach((node) => {
    if (node.type !== "agent") return;
    const agentNode = node as AgentNode;
    if (agentNode.config.model === "__USER_ASSIGNED__")
      warning("WARN_001", node.id, `${node.label} has no AI model assigned`, "Open this node and assign a model and API key before running");
    if (!agentNode.config.system_prompt || agentNode.config.system_prompt.trim() === "")
      warning("WARN_002", node.id, `${node.label} has no system prompt`, "Add a system prompt to define what this agent should do");
  });

  // ─── WARN_005: agent output fields read downstream but never declared ─────
  //
  // The failure this catches is silent end to end. output_schema is what tells
  // the model which keys to emit; without it the agent answers in prose, the
  // runtime stores that as {"text": "..."}, and a filter reading
  // data['nX'].get('is_important') just gets its default. Every row drops, the
  // nodes behind the filter are skipped, and the run still reports success — so
  // nothing looks broken except the missing output.
  //
  // ERR_010 above only covers edge.data_mapping and gives up when output_schema
  // is null, which is precisely the broken case, so check the real reference
  // sites: filter/branch conditions, transforms, format templates and connector
  // params.
  execNodes.forEach((node) => {
    if (node.type !== "agent") return;
    const agentNode = node as AgentNode;
    const referenced = referencedFieldsFor(node.id, execNodes);
    if (referenced.size === 0) return;

    const outputSchema = agentNode.config.output_schema;
    const undeclared = [...referenced].filter(
      (field) => !outputSchema || !schemaHasField(outputSchema, field)
    );
    if (undeclared.length === 0) return;

    const list = undeclared.map((f) => `"${f}"`).join(", ");
    warning(
      "WARN_005",
      node.id,
      `Later nodes read ${list} from ${node.label}, but it does not promise to return ${undeclared.length === 1 ? "that field" : "those fields"}`,
      outputSchema
        ? `Add ${undeclared.join(", ")} to this agent's output schema.`
        : `Set this agent's output schema to return ${undeclared.join(", ")}. Without it the agent replies in prose, those reads fall back to their defaults, and everything downstream is skipped without an error.`
    );
  });

  // ─── ERR_014: write-scoped connection node without an operation ───────────
  // The runtime treats an operation-less connection node as an auth-only
  // pass-through and returns success. That is fine for read-scoped nodes that
  // only supply a connection, but a write-scoped node exists to perform an
  // action — without an operation the run completes green having done nothing.
  // (Seen in the wild: Genesis emitted `operation: null` on a gmail label node
  // and normalizeSchema healed the null away, leaving a silent no-op.)

  execNodes.forEach((node) => {
    if (node.type !== "connection") return;
    const connNode = node as ConnectionNode;
    if (connNode.config.connector_type === "http") return;
    const config = connNode.config as OAuthConnectionConfig;
    if (config.operation) return;
    if (config.scope_access === "write" || config.scope_access === "read_write") {
      error(
        "ERR_014",
        node.id,
        `${node.label} has write access but no operation selected — it would run as a do-nothing step`,
        "Open this node and choose the action it should perform (e.g. label_email, send_email)"
      );
    }
  });

  // Connection nodes with an operation set must have all required params filled.
  // Genesis uses "__USER_ASSIGNED__" as a sentinel for unknown resource IDs.
  execNodes.forEach((node) => {
    if (node.type !== "connection") return;
    const connNode = node as ConnectionNode;
    if (connNode.config.connector_type === "http") return;
    const config = connNode.config as OAuthConnectionConfig;
    if (!config.operation) return;
    const provider = availableConnections.find((c) => c.name === node.connection)?.provider ?? config.provider ?? "";
    if (!provider) return;
    const missing = getMissingRequiredParams(provider, config.operation, config.operation_params);
    if (missing.length > 0) {
      warning(
        "WARN_004",
        node.id,
        `${node.label} needs ${missing.length === 1 ? "a value" : "values"} for: ${missing.join(", ")}`,
        "Open this node and fill in the highlighted fields before running"
      );
    }
  });

  // ─── WARN_003: multiple write-access nodes sharing the same connection ────

  const writeNodesByConnection = new Map<string, string[]>();
  execNodes.forEach((node) => {
    if (!node.connection) return;
    const config = (node as AgentNode).config;
    const scopeAccess = "scope_access" in config ? config.scope_access : null;
    if (scopeAccess === "write" || scopeAccess === "read_write") {
      const existing = writeNodesByConnection.get(node.connection) ?? [];
      writeNodesByConnection.set(node.connection, [...existing, node.id]);
    }
  });
  writeNodesByConnection.forEach((nodeIds, connectionName) => {
    if (nodeIds.length > 1) {
      nodeIds.forEach((nodeId) => {
        warning(
          "WARN_003",
          nodeId,
          `Multiple nodes write to "${connectionName}" — possible concurrency conflict`,
          "Consider adding a step node to serialize writes, or split into separate programs"
        );
      });
    }
  });

  // ─── Build node_states ──────────────────────────────────────────────────

  const node_states: Record<string, NodeValidationState> = {};
  nodes.forEach((node) => {
    const hasError = errors.some((e) => e.node_id === node.id);
    const hasWarning = warnings.some((w) => w.node_id === node.id);
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
        const provider = availableConnections.find((c) => c.name === node.connection)?.provider ?? cfg.provider ?? "";
        if (!provider) return false;
        return getMissingRequiredParams(provider, cfg.operation, cfg.operation_params).length > 0;
      })();

    if (hasError) node_states[node.id] = "error";
    else if (isAgentUnassigned || isConnectionUnassigned) node_states[node.id] = "unassigned";
    else if (hasWarning) node_states[node.id] = "warning";
    else node_states[node.id] = "valid";
  });

  return { valid: errors.length === 0, errors, warnings, node_states };
}

// ─── Internal Platform Reference ───────────────────────────────────────────

// The internal "corelyx" reference covers the account tools (e.g.
// corelyx.report_to_user) that the runtime auto-provides. It is matched as the
// bare "corelyx" or a "corelyx:<alias>" form. These are not connectable apps and
// must never be treated as missing connections.
function isInternalPlatformRef(connection: string): boolean {
  return connection === "corelyx" || connection.startsWith("corelyx:");
}

// ─── Cycle Detection (DFS) ─────────────────────────────────────────────────

function detectCycles(nodes: Node[], edges: Edge[]): string[][] {
  const adj = new Map<string, string[]>();
  nodes.forEach((n) => adj.set(n.id, []));
  edges.forEach((e) => adj.get(e.from)?.push(e.to));

  const visited = new Set<string>();
  const inStack = new Set<string>();
  const cycles: string[][] = [];

  function dfs(nodeId: string, stack: string[]) {
    visited.add(nodeId);
    inStack.add(nodeId);
    stack.push(nodeId);

    for (const neighbor of adj.get(nodeId) ?? []) {
      if (!visited.has(neighbor)) {
        dfs(neighbor, stack);
      } else if (inStack.has(neighbor)) {
        const cycleStart = stack.indexOf(neighbor);
        cycles.push(stack.slice(cycleStart));
      }
    }

    stack.pop();
    inStack.delete(nodeId);
  }

  nodes.forEach((n) => {
    if (!visited.has(n.id)) dfs(n.id, []);
  });

  return cycles;
}

// ─── Downstream Field References ───────────────────────────────────────────

/** Every string in a node config, without JSON-escaping the quotes we match on. */
function collectStrings(value: unknown, out: string[]): void {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => collectStrings(v, out));
  else if (value && typeof value === "object") Object.values(value).forEach((v) => collectStrings(v, out));
}

/**
 * Field names other nodes read off `nodeId`, in either supported form:
 * Python-ish access in step conditions and transforms —
 * `data['n6'].get('is_important')`, `data['n6']['summary']` — and `{{n6.summary}}`
 * placeholders in format templates and connector params.
 */
function referencedFieldsFor(nodeId: string, nodes: Node[]): Set<string> {
  const fields = new Set<string>();
  const id = nodeId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`data\\[\\s*['"]${id}['"]\\s*\\]\\s*\\.\\s*get\\(\\s*['"]([\\w-]+)['"]`, "g"),
    new RegExp(`data\\[\\s*['"]${id}['"]\\s*\\]\\s*\\[\\s*['"]([\\w-]+)['"]\\s*\\]`, "g"),
    new RegExp(`\\{\\{\\s*${id}\\.([\\w-]+)`, "g"),
  ];

  for (const node of nodes) {
    if (node.id === nodeId) continue;
    const strings: string[] = [];
    collectStrings(node.config, strings);
    for (const text of strings) {
      for (const pattern of patterns) {
        pattern.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(text)) !== null) fields.add(match[1]!);
      }
    }
  }
  return fields;
}

// ─── Schema Field Check ────────────────────────────────────────────────────

function schemaHasField(
  schema: { type: string; properties?: Record<string, unknown> },
  field: string
): boolean {
  if (schema.type !== "object" || !schema.properties) return false;
  return field in schema.properties;
}
