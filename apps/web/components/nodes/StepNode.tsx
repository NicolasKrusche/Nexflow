"use client";

import React from "react";
import { Handle, Position } from "@xyflow/react";
import type { NodeProps } from "@xyflow/react";
import { NodeShell } from "./NodeShell";
import type { NodeValidationState, ValidationError, ValidationWarning } from "@/lib/validation";
import type { NodeStatus, StepConfig } from "@flowos/schema";

interface StepNodeData {
  label: string;
  description: string;
  connection: null;
  status: NodeStatus;
  config: StepConfig;
  validationState: NodeValidationState;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

const LOGIC_TYPE_LABEL: Record<StepConfig["logic_type"], string> = {
  transform: "Transform",
  filter: "Filter",
  branch: "Branch",
};

export function StepNode({ data, selected }: NodeProps) {
  const nodeData = data as unknown as StepNodeData;
  const logicType = nodeData.config?.logic_type as StepConfig["logic_type"] | undefined;

  return (
    <>
      {/* Target handle — top */}
      <Handle
        type="target"
        position={Position.Top}
        className="!bg-blue-500 !border-2 !border-background !w-3 !h-3"
      />

      <NodeShell
        selected={selected ?? false}
        validationState={nodeData.validationState ?? "valid"}
        status={nodeData.status}
        accentColor="bg-blue-500"
      >
        {/* Type badge */}
        <div className="flex items-center gap-1.5 mb-1">
          <span className="inline-flex items-center rounded-sm bg-blue-500/15 px-1.5 py-0.5 text-[10px] font-medium text-blue-700 dark:text-blue-400 uppercase tracking-wide">
            Step
          </span>
          {logicType && (
            <span className="inline-flex items-center rounded-sm bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 text-[10px] font-medium text-slate-600 dark:text-slate-300">
              {LOGIC_TYPE_LABEL[logicType]}
            </span>
          )}
        </div>

        {/* Label */}
        <p className="text-sm font-semibold text-foreground leading-tight truncate pr-4">
          {nodeData.label || "Untitled Step"}
        </p>

        {/* Description */}
        {nodeData.description && (
          <p className="text-[11px] text-muted-foreground leading-tight line-clamp-2">
            {nodeData.description}
          </p>
        )}

        {/* Validation errors */}
        {nodeData.errors?.length > 0 && (
          <div className="mt-1 text-[10px] text-red-600 dark:text-red-400 font-medium">
            {nodeData.errors[0].message}
          </div>
        )}
        {nodeData.warnings?.length > 0 && nodeData.errors?.length === 0 && (
          <div className="mt-1 text-[10px] text-yellow-600 dark:text-yellow-400 font-medium">
            {nodeData.warnings[0].message}
          </div>
        )}
      </NodeShell>

      {/* Source handle — bottom */}
      <Handle
        type="source"
        position={Position.Bottom}
        className="!bg-blue-500 !border-2 !border-background !w-3 !h-3"
      />
    </>
  );
}
