"use client";

import React from "react";
import { Handle, Position } from "@xyflow/react";
import type { NodeProps } from "@xyflow/react";
import { NodeShell } from "./NodeShell";
import type { NodeValidationState, ValidationError, ValidationWarning } from "@/lib/validation";
import type { NodeStatus, TriggerConfig } from "@flowos/schema";

interface TriggerNodeData {
  label: string;
  description: string;
  connection: string | null;
  status: NodeStatus;
  config: TriggerConfig;
  validationState: NodeValidationState;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

const TRIGGER_TYPE_LABEL: Record<TriggerConfig["trigger_type"], string> = {
  cron: "Cron Schedule",
  event: "Event",
  webhook: "Webhook",
  manual: "Manual",
  program_output: "Program Output",
};

export function TriggerNode({ data, selected }: NodeProps) {
  const nodeData = data as unknown as TriggerNodeData;
  const triggerType = nodeData.config?.trigger_type as TriggerConfig["trigger_type"] | undefined;

  return (
    <>
      <NodeShell
        selected={selected ?? false}
        validationState={nodeData.validationState ?? "valid"}
        status={nodeData.status}
        accentColor="bg-green-500"
      >
        {/* Type badge */}
        <div className="flex items-center gap-1.5 mb-1">
          <span className="inline-flex items-center rounded-sm bg-green-500/15 px-1.5 py-0.5 text-[10px] font-medium text-green-700 dark:text-green-400 uppercase tracking-wide">
            Trigger
          </span>
          {triggerType && (
            <span className="text-[10px] text-muted-foreground">
              {TRIGGER_TYPE_LABEL[triggerType]}
            </span>
          )}
        </div>

        {/* Label */}
        <p className="text-sm font-semibold text-foreground leading-tight truncate pr-4">
          {nodeData.label || "Untitled Trigger"}
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

      {/* Source handle only — triggers have no incoming connections */}
      <Handle
        type="source"
        position={Position.Bottom}
        className="!bg-green-500 !border-2 !border-background !w-3 !h-3"
      />
    </>
  );
}
