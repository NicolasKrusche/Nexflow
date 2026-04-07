"use client";

import React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { ValidationResult } from "@/lib/validation";

// ─── Types ────────────────────────────────────────────────────────────────────

interface EditorToolbarProps {
  programId: string;
  programName: string;
  isDirty: boolean;
  isSaving: boolean;
  canUndo: boolean;
  canRedo: boolean;
  validationResult: ValidationResult | null;
  onUndo: () => void;
  onRedo: () => void;
  onSave: () => void;
  onValidate: () => void;
  onRun: () => void;
  onBack: () => void;
  onAddNode: (type: "trigger" | "agent" | "step") => void;
  onHistory: () => void;
}

// ─── Icons (inline SVG, no icon library dep) ─────────────────────────────────

function UndoIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.75} className="h-3.5 w-3.5">
      <path d="M3 6H10a4 4 0 010 8H6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3 6L6 3M3 6l3 3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function RedoIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.75} className="h-3.5 w-3.5">
      <path d="M13 6H6a4 4 0 000 8h4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M13 6L10 3M13 6l-3 3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SaveIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.75} className="h-3.5 w-3.5">
      <path d="M12 13H4a1 1 0 01-1-1V4a1 1 0 011-1h7l2 2v7a1 1 0 01-1 1z" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M10 13V9H6v4M6 3v3h3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function RunIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
      <path d="M4 2.5l9 5.5-9 5.5V2.5z" />
    </svg>
  );
}

function ValidateIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.75} className="h-3.5 w-3.5">
      <circle cx="8" cy="8" r="6" />
      <path d="M5 8l2 2 4-4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function HistoryIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.75} className="h-3.5 w-3.5">
      <circle cx="8" cy="8" r="6" />
      <path d="M8 5v3l2 1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ─── Separator ────────────────────────────────────────────────────────────────

function Sep() {
  return <div className="h-5 w-px bg-border mx-1" />;
}

// ─── EditorToolbar ────────────────────────────────────────────────────────────

export function EditorToolbar({
  programId,
  programName,
  isDirty,
  isSaving,
  canUndo,
  canRedo,
  validationResult,
  onUndo,
  onRedo,
  onSave,
  onValidate,
  onRun,
  onBack,
  onAddNode,
  onHistory,
}: EditorToolbarProps) {
  const hasErrors = validationResult && !validationResult.valid;
  const isValid = validationResult?.valid === true;

  function handleBack() {
    if (isDirty) {
      const confirmed = window.confirm(
        "You have unsaved changes. Leave without saving?"
      );
      if (!confirmed) return;
    }
    onBack();
  }

  return (
    <header className="fixed top-0 left-0 right-0 z-40 h-14 flex items-center gap-2 px-3 bg-background border-b border-border shadow-sm">
      {/* Back */}
      <Button
        variant="ghost"
        size="sm"
        onClick={handleBack}
        className="gap-1 text-muted-foreground hover:text-foreground shrink-0"
      >
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={2} className="h-3.5 w-3.5">
          <path d="M10 4L6 8l4 4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Back
      </Button>

      <Sep />

      {/* Program name + save status */}
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-sm font-semibold text-foreground truncate max-w-[200px]">
          {programName}
        </span>
        <span
          className={cn(
            "text-[10px] font-medium shrink-0",
            isSaving && "text-muted-foreground",
            !isSaving && isDirty && "text-amber-600 dark:text-amber-400",
            !isSaving && !isDirty && "text-green-600 dark:text-green-400"
          )}
        >
          {isSaving ? "Saving…" : isDirty ? "Unsaved" : "Saved"}
        </span>
      </div>

      <Sep />

      {/* Add node buttons */}
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onAddNode("trigger")}
          className="gap-1 text-green-700 dark:text-green-400 border-green-200 dark:border-green-800 hover:bg-green-50 dark:hover:bg-green-950/30"
        >
          <span className="text-[10px]">+</span> Trigger
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onAddNode("agent")}
          className="gap-1 text-purple-700 dark:text-purple-400 border-purple-200 dark:border-purple-800 hover:bg-purple-50 dark:hover:bg-purple-950/30"
        >
          <span className="text-[10px]">+</span> Agent
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onAddNode("step")}
          className="gap-1 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-800 hover:bg-blue-50 dark:hover:bg-blue-950/30"
        >
          <span className="text-[10px]">+</span> Step
        </Button>
      </div>

      <Sep />

      {/* Undo / Redo */}
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          onClick={onUndo}
          disabled={!canUndo}
          className="h-7 w-7"
          title="Undo (Cmd+Z)"
          aria-label="Undo"
        >
          <UndoIcon />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={onRedo}
          disabled={!canRedo}
          className="h-7 w-7"
          title="Redo (Cmd+Shift+Z)"
          aria-label="Redo"
        >
          <RedoIcon />
        </Button>
      </div>

      {/* History */}
      <Button
        variant="ghost"
        size="sm"
        onClick={onHistory}
        className="gap-1.5 text-muted-foreground hover:text-foreground"
        title="Version history"
      >
        <HistoryIcon />
        History
      </Button>

      {/* Spacer pushes remaining buttons to the right */}
      <div className="flex-1" />

      {/* Validate */}
      <Button
        variant="outline"
        size="sm"
        onClick={onValidate}
        className="gap-1.5"
        title="Validate schema"
      >
        <ValidateIcon />
        Validate
        {validationResult && (
          <span
            className={cn(
              "inline-flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold",
              hasErrors
                ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400"
                : "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-400"
            )}
          >
            {hasErrors ? validationResult.errors.length : "✓"}
          </span>
        )}
      </Button>

      {/* Save */}
      <Button
        variant="outline"
        size="sm"
        onClick={onSave}
        disabled={!isDirty || isSaving}
        className="gap-1.5"
        title="Save (Cmd+S)"
      >
        <SaveIcon />
        {isSaving ? "Saving…" : "Save"}
      </Button>

      {/* Run */}
      <div className="relative group">
        <Button
          size="sm"
          onClick={onRun}
          disabled={hasErrors === true}
          className={cn(
            "gap-1.5",
            isValid
              ? "bg-green-600 hover:bg-green-700 text-white"
              : hasErrors
              ? "bg-green-600/40 text-white cursor-not-allowed"
              : "bg-green-600 hover:bg-green-700 text-white"
          )}
          title={hasErrors ? "Fix validation errors before running" : "Run program"}
        >
          <RunIcon />
          Run
        </Button>
        {hasErrors && (
          <div className="absolute bottom-full right-0 mb-2 hidden group-hover:block z-50">
            <div className="rounded-md bg-popover border border-border shadow-md px-3 py-2 text-xs text-foreground whitespace-nowrap">
              Fix {validationResult?.errors.length} error{validationResult?.errors.length !== 1 ? "s" : ""} before running
            </div>
          </div>
        )}
      </div>
    </header>
  );
}
