"use client";

import React from "react";
import { cn } from "@/lib/utils";
import type { NodeStatus } from "@flowos/schema";
import type { NodeValidationState } from "@/lib/validation";

// ─── Status Icons ─────────────────────────────────────────────────────────────

function StatusIcon({ status }: { status: NodeStatus | undefined }) {
  if (!status || status === "idle") return null;

  if (status === "running") {
    return (
      <span
        className="inline-block h-3 w-3 rounded-full border-2 border-blue-400 border-t-transparent animate-spin"
        aria-label="Running"
      />
    );
  }

  if (status === "success") {
    return (
      <svg
        className="h-3.5 w-3.5 text-green-500"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        aria-label="Success"
      >
        <path d="M3 8l3.5 3.5 6.5-7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  if (status === "failed") {
    return (
      <svg
        className="h-3.5 w-3.5 text-red-500"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        aria-label="Failed"
      >
        <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
      </svg>
    );
  }

  if (status === "waiting_approval") {
    return (
      <svg
        className="h-3.5 w-3.5 text-yellow-500"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        aria-label="Waiting for approval"
      >
        <circle cx="8" cy="8" r="6" />
        <path d="M8 5v3.5l2 1.5" strokeLinecap="round" />
      </svg>
    );
  }

  if (status === "skipped") {
    return (
      <svg
        className="h-3.5 w-3.5 text-slate-400"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        aria-label="Skipped"
      >
        <path d="M4 8h8" strokeLinecap="round" />
      </svg>
    );
  }

  return null;
}

// ─── NodeShell Props ──────────────────────────────────────────────────────────

export interface NodeShellProps {
  selected: boolean;
  validationState: NodeValidationState;
  status?: NodeStatus;
  accentColor?: string; // Tailwind bg+text class, e.g. "bg-green-500/10 text-green-700"
  children: React.ReactNode;
  className?: string;
}

// ─── NodeShell ────────────────────────────────────────────────────────────────

export function NodeShell({
  selected,
  validationState,
  status,
  accentColor,
  children,
  className,
}: NodeShellProps) {
  const borderClass = cn(
    "border-2",
    validationState === "error" && "border-red-500",
    validationState === "warning" && "border-yellow-400",
    validationState === "unassigned" && "border-slate-400 border-dashed",
    validationState === "valid" && selected && "border-blue-500",
    validationState === "valid" && !selected && "border-slate-200 dark:border-slate-700"
  );

  return (
    <div
      className={cn(
        "relative rounded-lg bg-card shadow-sm transition-shadow",
        "w-[200px] min-h-[80px] px-3 py-2.5",
        "flex flex-col gap-1",
        borderClass,
        selected && "shadow-md",
        className
      )}
    >
      {/* Status indicator — top right */}
      <div className="absolute top-2 right-2 flex items-center">
        <StatusIcon status={status} />
      </div>

      {/* Accent strip (optional) */}
      {accentColor && (
        <div className={cn("absolute top-0 left-0 right-0 h-1 rounded-t-lg", accentColor)} />
      )}

      {children}
    </div>
  );
}
