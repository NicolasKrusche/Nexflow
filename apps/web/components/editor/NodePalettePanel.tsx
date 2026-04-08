"use client";

import React from "react";
import { cn } from "@/lib/utils";

// ─── Variant type — exported so EditorShell + Toolbar can share it ────────────

export type TriggerSubtype = "manual" | "cron" | "webhook" | "event" | "program_output";
export type StepSubtype = "transform" | "filter" | "branch" | "delay" | "loop" | "format" | "parse" | "deduplicate" | "sort";
export type ConnectionSubtype =
  | "http"
  | "gmail" | "notion" | "slack" | "github" | "sheets"
  | "calendar" | "docs" | "drive" | "airtable" | "hubspot"
  | "typeform" | "asana" | "outlook";

export type NodeVariant =
  | { type: "trigger"; subtype: TriggerSubtype }
  | { type: "agent" }
  | { type: "step"; subtype: StepSubtype }
  | { type: "connection"; subtype: ConnectionSubtype };

// ─── Catalog ──────────────────────────────────────────────────────────────────

interface NodeTemplate {
  variant: NodeVariant;
  label: string;
  description: string;
  icon: React.ReactNode;
}

interface Category {
  id: string;
  label: string;
  color: string;        // Tailwind text color
  bgColor: string;      // Tailwind bg for badge
  templates: NodeTemplate[];
}

function TrigIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
      <path d="M8 1a7 7 0 100 14A7 7 0 008 1zm0 2a5 5 0 110 10A5 5 0 018 3zm.5 2.5h-1v4l3 1.8.5-.87-2.5-1.5V5.5z" />
    </svg>
  );
}

function AgentIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-3.5 w-3.5">
      <circle cx="8" cy="6" r="3" />
      <path d="M2 14c0-3.314 2.686-6 6-6s6 2.686 6 6" strokeLinecap="round" />
    </svg>
  );
}

function StepIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-3.5 w-3.5">
      <rect x="2" y="2" width="5" height="5" rx="1" />
      <rect x="9" y="9" width="5" height="5" rx="1" />
      <path d="M7 4.5h2M9 4.5V7a2 2 0 002 2h.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function HttpIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-3.5 w-3.5">
      <path d="M2 8h12M8 2l4 6-4 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ProviderIcon({ letter }: { letter: string }) {
  return (
    <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded text-[8px] font-bold bg-current/20">
      {letter}
    </span>
  );
}

const CATEGORIES: Category[] = [
  {
    id: "triggers",
    label: "Triggers",
    color: "text-green-700 dark:text-green-400",
    bgColor: "bg-green-500/15",
    templates: [
      {
        variant: { type: "trigger", subtype: "manual" },
        label: "Manual",
        description: "Run on demand via API or button",
        icon: <svg viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5"><path d="M4 2.5l9 5.5-9 5.5V2.5z" /></svg>,
      },
      {
        variant: { type: "trigger", subtype: "cron" },
        label: "Cron schedule",
        description: "Run on a time-based schedule",
        icon: <TrigIcon />,
      },
      {
        variant: { type: "trigger", subtype: "webhook" },
        label: "Webhook",
        description: "Run when an HTTP request is received",
        icon: <HttpIcon />,
      },
      {
        variant: { type: "trigger", subtype: "event" },
        label: "Event",
        description: "Run on a named event from a provider",
        icon: (
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-3.5 w-3.5">
            <path d="M8 2v4l3 1.5" strokeLinecap="round" /><circle cx="8" cy="8" r="6" />
          </svg>
        ),
      },
      {
        variant: { type: "trigger", subtype: "program_output" },
        label: "Program output",
        description: "Chain — fire when another program finishes",
        icon: (
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-3.5 w-3.5">
            <path d="M3 8h10M9 4l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ),
      },
    ],
  },
  {
    id: "agents",
    label: "Agents",
    color: "text-purple-700 dark:text-purple-400",
    bgColor: "bg-purple-500/15",
    templates: [
      {
        variant: { type: "agent" },
        label: "AI Agent",
        description: "LLM-powered agent with tool access",
        icon: <AgentIcon />,
      },
    ],
  },
  {
    id: "logic",
    label: "Logic",
    color: "text-blue-700 dark:text-blue-400",
    bgColor: "bg-blue-500/15",
    templates: [
      {
        variant: { type: "step", subtype: "transform" },
        label: "Transform",
        description: "Map / reshape data with a JS expression",
        icon: <StepIcon />,
      },
      {
        variant: { type: "step", subtype: "filter" },
        label: "Filter",
        description: "Pass or stop data on a condition",
        icon: (
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-3.5 w-3.5">
            <path d="M2 4h12M5 8h6M8 12h0" strokeLinecap="round" />
          </svg>
        ),
      },
      {
        variant: { type: "step", subtype: "branch" },
        label: "Branch",
        description: "Route to different nodes conditionally",
        icon: (
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-3.5 w-3.5">
            <path d="M8 3v4M5 10l3-3 3 3M5 13h6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ),
      },
      {
        variant: { type: "step", subtype: "loop" },
        label: "Loop",
        description: "Iterate over every item in an array",
        icon: (
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-3.5 w-3.5">
            <path d="M3 8a5 5 0 0110 0" strokeLinecap="round" />
            <path d="M13 8a5 5 0 01-10 0" strokeLinecap="round" strokeDasharray="2 2" />
            <path d="M12 5l1 3 2-2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ),
      },
      {
        variant: { type: "step", subtype: "delay" },
        label: "Delay",
        description: "Pause execution for N seconds",
        icon: (
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-3.5 w-3.5">
            <circle cx="8" cy="8" r="6" />
            <path d="M8 5v3l2 1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ),
      },
      {
        variant: { type: "step", subtype: "format" },
        label: "Format",
        description: "Interpolate values into a string template",
        icon: (
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-3.5 w-3.5">
            <path d="M3 5h10M3 8h7M3 11h5" strokeLinecap="round" />
          </svg>
        ),
      },
      {
        variant: { type: "step", subtype: "parse" },
        label: "Parse",
        description: "Parse JSON, CSV, or line-delimited text",
        icon: (
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-3.5 w-3.5">
            <path d="M5 3l-3 5 3 5M11 3l3 5-3 5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ),
      },
      {
        variant: { type: "step", subtype: "deduplicate" },
        label: "Deduplicate",
        description: "Remove duplicate items from an array by key",
        icon: (
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-3.5 w-3.5">
            <rect x="2" y="5" width="8" height="8" rx="1" />
            <path d="M6 5V4a1 1 0 011-1h6a1 1 0 011 1v7a1 1 0 01-1 1h-1" strokeLinecap="round" />
          </svg>
        ),
      },
      {
        variant: { type: "step", subtype: "sort" },
        label: "Sort",
        description: "Sort an array ascending or descending by field",
        icon: (
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-3.5 w-3.5">
            <path d="M4 3v10M4 13l-2-2M4 13l2-2M12 3v10M12 3l-2 2M12 3l2 2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ),
      },
    ],
  },
  {
    id: "connections",
    label: "Connections",
    color: "text-slate-700 dark:text-slate-300",
    bgColor: "bg-slate-500/15",
    templates: [
      {
        variant: { type: "connection", subtype: "http" },
        label: "HTTP Request",
        description: "Call any REST API endpoint",
        icon: <HttpIcon />,
      },
      {
        variant: { type: "connection", subtype: "gmail" },
        label: "Gmail",
        description: "Send, read, and manage Gmail messages",
        icon: <ProviderIcon letter="G" />,
      },
      {
        variant: { type: "connection", subtype: "notion" },
        label: "Notion",
        description: "Read and write Notion pages & databases",
        icon: <ProviderIcon letter="N" />,
      },
      {
        variant: { type: "connection", subtype: "slack" },
        label: "Slack",
        description: "Post messages and manage channels",
        icon: <ProviderIcon letter="S" />,
      },
      {
        variant: { type: "connection", subtype: "github" },
        label: "GitHub",
        description: "Create issues, PRs, and push files",
        icon: <ProviderIcon letter="GH" />,
      },
      {
        variant: { type: "connection", subtype: "sheets" },
        label: "Google Sheets",
        description: "Read and write spreadsheet data",
        icon: <ProviderIcon letter="S" />,
      },
      {
        variant: { type: "connection", subtype: "calendar" },
        label: "Google Calendar",
        description: "List and create calendar events",
        icon: <ProviderIcon letter="C" />,
      },
      {
        variant: { type: "connection", subtype: "docs" },
        label: "Google Docs",
        description: "Read and write documents",
        icon: <ProviderIcon letter="D" />,
      },
      {
        variant: { type: "connection", subtype: "drive" },
        label: "Google Drive",
        description: "List, share, and manage Drive files",
        icon: <ProviderIcon letter="Dr" />,
      },
      {
        variant: { type: "connection", subtype: "airtable" },
        label: "Airtable",
        description: "CRUD records in Airtable bases",
        icon: <ProviderIcon letter="A" />,
      },
      {
        variant: { type: "connection", subtype: "hubspot" },
        label: "HubSpot",
        description: "Manage contacts and deals",
        icon: <ProviderIcon letter="H" />,
      },
      {
        variant: { type: "connection", subtype: "typeform" },
        label: "Typeform",
        description: "Read forms and responses",
        icon: <ProviderIcon letter="T" />,
      },
      {
        variant: { type: "connection", subtype: "asana" },
        label: "Asana",
        description: "Create and update tasks and projects",
        icon: <ProviderIcon letter="As" />,
      },
      {
        variant: { type: "connection", subtype: "outlook" },
        label: "Outlook",
        description: "Send and read Outlook mail",
        icon: <ProviderIcon letter="O" />,
      },
    ],
  },
];

// ─── NodePalettePanel ─────────────────────────────────────────────────────────

interface NodePalettePanelProps {
  onAdd: (variant: NodeVariant) => void;
  onClose: () => void;
}

export function NodePalettePanel({ onAdd, onClose }: NodePalettePanelProps) {
  return (
    <aside
      className={cn(
        "fixed left-0 bottom-0 z-20 w-60",
        "bg-background border-r border-border shadow-lg",
        "flex flex-col overflow-hidden",
      )}
      style={{ top: 56 }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border shrink-0">
        <span className="text-xs font-semibold">Add node</span>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-0.5 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          aria-label="Close palette"
        >
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={2} className="h-3.5 w-3.5">
            <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {/* Scrollable categories */}
      <div className="flex-1 overflow-y-auto py-2">
        {CATEGORIES.map((cat) => (
          <div key={cat.id} className="mb-1">
            {/* Category header */}
            <div className={cn("px-3 py-1.5 flex items-center gap-1.5")}>
              <span className={cn("text-[10px] font-semibold uppercase tracking-wider", cat.color)}>
                {cat.label}
              </span>
            </div>

            {/* Templates */}
            <div className="px-2 space-y-0.5">
              {cat.templates.map((tpl) => {
                const key =
                  tpl.variant.type === "trigger" ? `trigger-${tpl.variant.subtype}`
                  : tpl.variant.type === "step" ? `step-${tpl.variant.subtype}`
                  : tpl.variant.type === "connection" ? `conn-${tpl.variant.subtype}`
                  : "agent";

                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => { onAdd(tpl.variant); onClose(); }}
                    className={cn(
                      "w-full flex items-center gap-2.5 rounded-md px-2.5 py-2 text-left",
                      "hover:bg-accent transition-colors group"
                    )}
                  >
                    {/* Icon badge */}
                    <span
                      className={cn(
                        "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md",
                        cat.bgColor,
                        cat.color,
                      )}
                    >
                      {tpl.icon}
                    </span>

                    {/* Text */}
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-foreground leading-tight truncate">
                        {tpl.label}
                      </p>
                      <p className="text-[10px] text-muted-foreground leading-tight mt-0.5 line-clamp-2">
                        {tpl.description}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Footer hint */}
      <div className="px-3 py-2 border-t border-border shrink-0">
        <p className="text-[10px] text-muted-foreground">
          Click a node to add it to the canvas
        </p>
      </div>
    </aside>
  );
}
