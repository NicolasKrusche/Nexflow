"use client";

import React from "react";
import { BaseEdge, EdgeLabelRenderer, getBezierPath } from "@xyflow/react";
import type { EdgeProps } from "@xyflow/react";

export function EventEdge({
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
          stroke: selected ? "#16a34a" : "#4ade80",
          strokeWidth: selected ? 2.5 : 1.5,
          strokeDasharray: "8 4",
          // CSS animation via inline keyframes fallback — animated prop on edge handles this
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
            className="nodrag nopan rounded px-1.5 py-0.5 bg-background border border-green-200 text-[10px] text-green-700 dark:text-green-400 shadow-sm"
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
