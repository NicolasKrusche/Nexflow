"use client";

import React from "react";
import { BaseEdge, EdgeLabelRenderer, getBezierPath } from "@xyflow/react";
import type { EdgeProps } from "@xyflow/react";

export function DataFlowEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  label,
  markerEnd,
  selected,
}: EdgeProps) {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          stroke: selected ? "#3b82f6" : "#60a5fa",
          strokeWidth: selected ? 2.5 : 1.5,
        }}
      />
      {label && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: "all",
            }}
            className="nodrag nopan rounded px-1.5 py-0.5 bg-background border border-border text-[10px] text-muted-foreground shadow-sm"
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
