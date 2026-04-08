"use client";

import React from "react";
import { Handle, Position } from "@xyflow/react";
import type { NodeProps } from "@xyflow/react";
import { NodeShell } from "./NodeShell";
import type { NodeValidationState, ValidationError, ValidationWarning } from "@/lib/validation";
import type {
  NodeStatus,
  ConnectionConfig,
  HttpConnectionConfig,
  OAuthConnectionConfig,
} from "@flowos/schema";

interface ConnectionNodeData {
  label: string;
  description: string;
  connection: string | null;
  status: NodeStatus;
  config: ConnectionConfig;
  validationState: NodeValidationState;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

const SCOPE_LABEL: Record<string, string> = {
  read: "Read",
  write: "Write",
  read_write: "Read + Write",
};

function isHttpConnectionConfig(
  config: ConnectionConfig
): config is HttpConnectionConfig {
  return config.connector_type === "http";
}

function isOAuthConnectionConfig(
  config: ConnectionConfig
): config is OAuthConnectionConfig {
  return config.connector_type !== "http";
}

export function ConnectionNode({ data, selected }: NodeProps) {
  const nodeData = data as unknown as ConnectionNodeData;
  const httpConfig = isHttpConnectionConfig(nodeData.config) ? nodeData.config : null;
  const oauthConfig = isOAuthConnectionConfig(nodeData.config) ? nodeData.config : null;

  return (
    <>
      {/* Target handle — top */}
      <Handle
        type="target"
        position={Position.Top}
        className="!bg-slate-500 !border-2 !border-background !w-3 !h-3"
      />

      <NodeShell
        selected={selected ?? false}
        validationState={nodeData.validationState ?? "valid"}
        status={nodeData.status}
        accentColor="bg-slate-500"
      >
        {/* Type badge */}
        <div className="flex items-center gap-1.5 mb-1">
          <span className="inline-flex items-center rounded-sm bg-slate-500/15 px-1.5 py-0.5 text-[10px] font-medium text-slate-700 dark:text-slate-300 uppercase tracking-wide">
            {httpConfig ? "HTTP Connector" : "Connection"}
          </span>
          {httpConfig ? (
            <span className="inline-flex items-center rounded-sm bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 text-[10px] font-medium text-slate-600 dark:text-slate-300">
              {httpConfig.method}
            </span>
          ) : (
            <span className="inline-flex items-center rounded-sm bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 text-[10px] font-medium text-slate-600 dark:text-slate-300">
              {oauthConfig
                ? (SCOPE_LABEL[oauthConfig.scope_access] ?? oauthConfig.scope_access)
                : "Read"}
            </span>
          )}
        </div>

        {/* Label */}
        <p className="text-sm font-semibold text-foreground leading-tight truncate pr-4">
          {nodeData.label || "Untitled Connection"}
        </p>

        {/* HTTP URL or OAuth connection name */}
        {httpConfig?.url && (
          <p className="text-[11px] text-muted-foreground truncate">
            {httpConfig.url}
          </p>
        )}
        {!httpConfig && nodeData.connection && (
          <p className="text-[11px] text-muted-foreground truncate">
            {nodeData.connection}
          </p>
        )}

        {/* Description */}
        {nodeData.description && (
          <p className="text-[11px] text-muted-foreground leading-tight line-clamp-1">
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
        className="!bg-slate-500 !border-2 !border-background !w-3 !h-3"
      />
    </>
  );
}
