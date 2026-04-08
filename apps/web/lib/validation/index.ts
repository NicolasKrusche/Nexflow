import type { ProgramSchema, Node, Edge, AgentNode, StepNode } from "@flowos/schema";

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
  const { nodes, edges } = schema;

  const nodeIds = nodes.map((n) => n.id);
  const availableConnectionNames = availableConnections.map((c) => c.name);

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

  const triggerNodes = nodes.filter((n) => n.type === "trigger");
  if (triggerNodes.length === 0)
    error("ERR_001", null, "Program has no trigger", "Add a trigger node to define when this program starts");

  if (triggerNodes.length > 1)
    error("ERR_002", null, "Program has multiple triggers", "Only one trigger node is allowed. Delete the extra trigger or split into separate programs");

  nodes.forEach((node) => {
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

  const cycles = detectCycles(nodes, edges);
  cycles.forEach((cycle) => {
    const hasBranchNode = cycle.some((id) => {
      const node = nodes.find((n) => n.id === id);
      return node?.type === "step" && (node as StepNode).config.logic_type === "branch";
    });
    if (!hasBranchNode)
      error("ERR_005", null, "Circular connection detected with no exit condition", "Add a branch node with an exit condition to break the loop");
  });

  if (nodes.length > 12)
    error("ERR_006", null, "Program exceeds maximum of 12 nodes", "Split this program into two smaller programs and use a program_output trigger to chain them");

  // ─── Connection References ─────────────────────────────────────────────

  nodes.forEach((node) => {
    if (node.connection && !availableConnectionNames.includes(node.connection))
      error("ERR_007", node.id, `${node.label} uses "${node.connection}" which is not connected to this program`, "Go to program settings and add this connection, or change the node to use an available connection");
  });

  nodes.forEach((node) => {
    if (node.type === "step" && node.connection !== null)
      error("ERR_009", node.id, `Step node ${node.label} cannot connect to an external app`, "Step nodes are for logic only. Use an agent node to interact with apps");
  });

  // ─── Data Flow ─────────────────────────────────────────────────────────

  edges.forEach((edge) => {
    if (!edge.data_mapping) return;
    const sourceNode = nodes.find((n) => n.id === edge.from);
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

  nodes.forEach((node) => {
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

  nodes.forEach((node) => {
    if (node.type !== "agent") return;
    const agentNode = node as AgentNode;
    if (agentNode.config.model === "__USER_ASSIGNED__")
      warning("WARN_001", node.id, `${node.label} has no AI model assigned`, "Open this node and assign a model and API key before running");
    if (!agentNode.config.system_prompt || agentNode.config.system_prompt.trim() === "")
      warning("WARN_002", node.id, `${node.label} has no system prompt`, "Add a system prompt to define what this agent should do");
  });

  // ─── WARN_003: multiple write-access nodes sharing the same connection ────

  const writeNodesByConnection = new Map<string, string[]>();
  nodes.forEach((node) => {
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
    const isUnassigned =
      node.type === "agent" &&
      ((node as AgentNode).config.model === "__USER_ASSIGNED__" ||
        (node as AgentNode).config.api_key_ref === "__USER_ASSIGNED__");

    if (hasError) node_states[node.id] = "error";
    else if (isUnassigned) node_states[node.id] = "unassigned";
    else if (hasWarning) node_states[node.id] = "warning";
    else node_states[node.id] = "valid";
  });

  return { valid: errors.length === 0, errors, warnings, node_states };
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

// ─── Schema Field Check ────────────────────────────────────────────────────

function schemaHasField(
  schema: { type: string; properties?: Record<string, unknown> },
  field: string
): boolean {
  if (schema.type !== "object" || !schema.properties) return false;
  return field in schema.properties;
}
