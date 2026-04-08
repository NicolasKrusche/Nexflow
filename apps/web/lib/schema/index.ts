import type { ProgramSchema, Node as SchemaNode, Edge as SchemaEdge } from "@flowos/schema";
import type {
  ValidationResult,
  ValidationError,
  ValidationWarning,
} from "@/lib/validation";
import type { Node as ReactFlowNode, Edge as ReactFlowEdge } from "@xyflow/react";
import { MarkerType } from "@xyflow/react";

// ─── toReactFlow ──────────────────────────────────────────────────────────────
// Converts canonical ProgramSchema → React Flow nodes + edges.
// Called on load. Merges validation state into node data.

export function toReactFlow(
  schema: ProgramSchema,
  validationResult: ValidationResult | null
): { nodes: ReactFlowNode[]; edges: ReactFlowEdge[] } {
  const nodeErrorsById = new Map<string, ValidationError[]>();
  const edgeErrorsById = new Map<string, ValidationError[]>();
  const nodeWarningsById = new Map<string, ValidationWarning[]>();

  for (const error of validationResult?.errors ?? []) {
    if (error.node_id) {
      const bucket = nodeErrorsById.get(error.node_id);
      if (bucket) {
        bucket.push(error);
      } else {
        nodeErrorsById.set(error.node_id, [error]);
      }
    }
    if (error.edge_id) {
      const bucket = edgeErrorsById.get(error.edge_id);
      if (bucket) {
        bucket.push(error);
      } else {
        edgeErrorsById.set(error.edge_id, [error]);
      }
    }
  }

  for (const warning of validationResult?.warnings ?? []) {
    if (!warning.node_id) continue;
    const bucket = nodeWarningsById.get(warning.node_id);
    if (bucket) {
      bucket.push(warning);
    } else {
      nodeWarningsById.set(warning.node_id, [warning]);
    }
  }

  const nodes: ReactFlowNode[] = schema.nodes.map((node) => {
    const validationState =
      validationResult?.node_states[node.id] ?? "valid";
    const errors = nodeErrorsById.get(node.id) ?? [];
    const warnings = nodeWarningsById.get(node.id) ?? [];

    return {
      id: node.id,
      type: node.type,
      position: { x: node.position.x, y: node.position.y },
      data: {
        label: node.label,
        description: node.description,
        connection: node.connection,
        status: node.status,
        config: node.config,
        validationState,
        errors,
        warnings,
      },
    };
  });

  const edges: ReactFlowEdge[] = schema.edges.map((edge) => {
    const validationErrors = edgeErrorsById.get(edge.id) ?? [];

    return {
      id: edge.id,
      source: edge.from,
      target: edge.to,
      type: edge.type,
      label: edge.label ?? undefined,
      animated: edge.type === "event_subscription",
      markerEnd: { type: MarkerType.ArrowClosed },
      data: {
        condition: edge.condition,
        data_mapping: edge.data_mapping,
        validationErrors,
      },
    };
  });

  return { nodes, edges };
}

// ─── fromReactFlow ────────────────────────────────────────────────────────────
// Converts React Flow nodes + edges → canonical ProgramSchema.
// Called on save. Preserves all config that React Flow doesn't know about.
// Roundtrip invariant: fromReactFlow(toReactFlow(schema, null).nodes,
//   toReactFlow(schema, null).edges, schema) deep-equals schema.

export function fromReactFlow(
  rfNodes: ReactFlowNode[],
  rfEdges: ReactFlowEdge[],
  existing: ProgramSchema
): ProgramSchema {
  // Build lookup maps for O(1) access
  const existingNodeMap = new Map<string, SchemaNode>(
    existing.nodes.map((n) => [n.id, n])
  );
  const existingEdgeMap = new Map<string, SchemaEdge>(
    existing.edges.map((e) => [e.id, e])
  );

  const nodes: SchemaNode[] = rfNodes.map((rfNode) => {
    const existing = existingNodeMap.get(rfNode.id);
    if (!existing) {
      // New node created in editor — rfNode.data contains the full initial config
      return {
        id: rfNode.id,
        type: rfNode.type as SchemaNode["type"],
        label: (rfNode.data.label as string) ?? "",
        description: (rfNode.data.description as string) ?? "",
        connection: (rfNode.data.connection as string | null) ?? null,
        position: { x: rfNode.position.x, y: rfNode.position.y },
        status: (rfNode.data.status as SchemaNode["status"]) ?? "idle",
        config: rfNode.data.config as SchemaNode["config"],
      } as SchemaNode;
    }

    // Merge: RF owns position and label/description only
    return {
      ...existing,
      position: { x: rfNode.position.x, y: rfNode.position.y },
      label: (rfNode.data.label as string) ?? existing.label,
      description: (rfNode.data.description as string) ?? existing.description,
    } as SchemaNode;
  });

  const edges: SchemaEdge[] = rfEdges.map((rfEdge) => {
    const existing = existingEdgeMap.get(rfEdge.id);
    if (!existing) {
      // New edge created via onConnect
      return {
        id: rfEdge.id,
        from: rfEdge.source,
        to: rfEdge.target,
        type: (rfEdge.type as SchemaEdge["type"]) ?? "data_flow",
        data_mapping: (rfEdge.data?.data_mapping as SchemaEdge["data_mapping"]) ?? null,
        condition: (rfEdge.data?.condition as string | null) ?? null,
        label: typeof rfEdge.label === "string" ? rfEdge.label : null,
      };
    }

    return {
      ...existing,
      from: rfEdge.source,
      to: rfEdge.target,
      label: typeof rfEdge.label === "string" ? rfEdge.label : null,
    };
  });

  return {
    ...existing,
    nodes,
    edges,
    updated_at: new Date().toISOString(),
  };
}
