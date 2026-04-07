import Dagre from "@dagrejs/dagre";
import type { Node as ReactFlowNode, Edge as ReactFlowEdge } from "@xyflow/react";

const NODE_WIDTH = 200;
const NODE_HEIGHT = 80;

// ─── applyDagreLayout ─────────────────────────────────────────────────────────
// Computes automatic layout positions using Dagre.
// Direction "LR" = left-to-right (default), "TB" = top-to-bottom.
// Returns a new nodes array with updated positions. Edges are unchanged.

export function applyDagreLayout(
  nodes: ReactFlowNode[],
  edges: ReactFlowEdge[],
  direction: "TB" | "LR" = "LR"
): ReactFlowNode[] {
  const g = new Dagre.graphlib.Graph();

  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: direction,
    ranksep: 150,
    nodesep: 80,
    marginx: 40,
    marginy: 40,
  });

  nodes.forEach((node) => {
    g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  });

  edges.forEach((edge) => {
    g.setEdge(edge.source, edge.target);
  });

  Dagre.layout(g);

  return nodes.map((node) => {
    const layoutNode = g.node(node.id);
    if (!layoutNode) return node;

    // Dagre positions are center-based; React Flow positions are top-left.
    return {
      ...node,
      position: {
        x: layoutNode.x - NODE_WIDTH / 2,
        y: layoutNode.y - NODE_HEIGHT / 2,
      },
    };
  });
}

// ─── needsLayout ─────────────────────────────────────────────────────────────
// Detects whether a freshly-generated schema needs auto-layout applied.
// Heuristic: all nodes are clustered at the same or default x position (100).

export function needsLayout(nodes: ReactFlowNode[]): boolean {
  if (nodes.length <= 1) return false;
  const xs = nodes.map((n) => n.position.x);
  const allSame = xs.every((x) => x === xs[0]);
  const allDefault = xs.every((x) => x === 100);
  return allSame || allDefault;
}
