"use client";

import React, { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import type {
  ProgramSchema,
  AgentConfig,
  StepConfig,
  TriggerConfig,
  BranchCondition,
  ConnectionConfig,
  HttpConnectionConfig,
  RetryConfig,
} from "@flowos/schema";
import type { ValidationError, ValidationWarning } from "@/lib/validation";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ApiKey {
  id: string;
  name: string;
  provider: string;
}

interface NodeSidebarProps {
  nodeId: string;
  schema: ProgramSchema;
  apiKeys: ApiKey[];
  onUpdate: (nodeId: string, config: Record<string, unknown>) => void;
  onClose: () => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function SidebarSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-5">
      <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
        {title}
      </h4>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function FieldGroup({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={htmlFor} className="text-xs">
        {label}
      </Label>
      {children}
    </div>
  );
}

function Toggle({
  id,
  checked,
  onChange,
  label,
}: {
  id: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <div className="flex items-center justify-between">
      <Label htmlFor={id} className="text-xs cursor-pointer">
        {label}
      </Label>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          checked ? "bg-primary" : "bg-input"
        )}
      >
        <span
          className={cn(
            "inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform",
            checked ? "translate-x-4" : "translate-x-1"
          )}
        />
      </button>
    </div>
  );
}

// ─── Validation Summary ───────────────────────────────────────────────────────

function ValidationSummary({
  errors,
  warnings,
}: {
  errors: ValidationError[];
  warnings: ValidationWarning[];
}) {
  if (errors.length === 0 && warnings.length === 0) return null;
  return (
    <div className="mb-4 space-y-2">
      {errors.map((e, i) => (
        <div
          key={i}
          className="rounded-md bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 px-3 py-2"
        >
          <p className="text-xs font-medium text-red-700 dark:text-red-400">{e.message}</p>
          <p className="text-[10px] text-red-600/80 dark:text-red-500 mt-0.5">{e.fix_suggestion}</p>
        </div>
      ))}
      {warnings.map((w, i) => (
        <div
          key={i}
          className="rounded-md bg-yellow-50 dark:bg-yellow-950/30 border border-yellow-200 dark:border-yellow-800 px-3 py-2"
        >
          <p className="text-xs font-medium text-yellow-700 dark:text-yellow-400">{w.message}</p>
          <p className="text-[10px] text-yellow-600/80 dark:text-yellow-500 mt-0.5">{w.fix_suggestion}</p>
        </div>
      ))}
    </div>
  );
}

// ─── Agent Config Tabs ────────────────────────────────────────────────────────

type AgentTab = "model" | "prompt" | "retry";

function AgentSidebar({
  config,
  apiKeys,
  onUpdate,
}: {
  config: AgentConfig;
  apiKeys: ApiKey[];
  onUpdate: (patch: Partial<AgentConfig>) => void;
}) {
  const [tab, setTab] = useState<AgentTab>("model");

  const tabs: { id: AgentTab; label: string }[] = [
    { id: "model", label: "Model" },
    { id: "prompt", label: "Prompt" },
    { id: "retry", label: "Retry" },
  ];

  return (
    <div>
      {/* Tab bar */}
      <div className="flex border-b border-border mb-4">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              "px-3 py-2 text-xs font-medium border-b-2 -mb-px transition-colors",
              tab === t.id
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Model tab */}
      {tab === "model" && (
        <div className="space-y-3">
          <FieldGroup label="API Key" htmlFor="agent-apikey">
            <Select
              id="agent-apikey"
              value={config.api_key_ref === "__USER_ASSIGNED__" ? "" : config.api_key_ref}
              onChange={(e) => {
                const keyId = e.target.value || "__USER_ASSIGNED__";
                const updates: Partial<AgentConfig> = { api_key_ref: keyId };
                if (config.model === "__USER_ASSIGNED__" && keyId !== "__USER_ASSIGNED__") {
                  const selectedKey = apiKeys.find((k) => k.id === keyId);
                  if (selectedKey?.provider === "openrouter") {
                    updates.model = "nvidia/nemotron-3-super-120b-a12b:free";
                  }
                }
                onUpdate(updates);
              }}
            >
              <option value="">— Select API Key —</option>
              {apiKeys.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.name} ({k.provider})
                </option>
              ))}
            </Select>
          </FieldGroup>

          <FieldGroup label="Model" htmlFor="agent-model">
            <Input
              id="agent-model"
              placeholder="e.g. claude-3-5-sonnet-20241022"
              value={config.model === "__USER_ASSIGNED__" ? "" : config.model}
              onChange={(e) =>
                onUpdate({ model: e.target.value || "__USER_ASSIGNED__" })
              }
            />
          </FieldGroup>

          <FieldGroup label="Scope Access" htmlFor="agent-scope">
            <Select
              id="agent-scope"
              value={config.scope_access}
              onChange={(e) =>
                onUpdate({ scope_access: e.target.value as AgentConfig["scope_access"] })
              }
            >
              <option value="read">Read</option>
              <option value="write">Write</option>
              <option value="read_write">Read + Write</option>
            </Select>
          </FieldGroup>
        </div>
      )}

      {/* Prompt tab */}
      {tab === "prompt" && (
        <div className="space-y-3">
          <FieldGroup label="System Prompt" htmlFor="agent-prompt">
            <Textarea
              id="agent-prompt"
              rows={8}
              placeholder="Describe what this agent should do..."
              value={config.system_prompt}
              onChange={(e) => onUpdate({ system_prompt: e.target.value })}
              className="text-xs resize-none"
            />
          </FieldGroup>

          <Toggle
            id="agent-approval"
            checked={config.requires_approval}
            onChange={(v) => onUpdate({ requires_approval: v })}
            label="Requires human approval"
          />

          {config.requires_approval && (
            <FieldGroup label="Approval timeout (hours)" htmlFor="agent-approval-timeout">
              <Input
                id="agent-approval-timeout"
                type="number"
                min={0}
                value={config.approval_timeout_hours}
                onChange={(e) =>
                  onUpdate({ approval_timeout_hours: Number(e.target.value) })
                }
              />
            </FieldGroup>
          )}
        </div>
      )}

      {/* Retry tab */}
      {tab === "retry" && (
        <div className="space-y-3">
          <FieldGroup label="Max attempts (1–5)" htmlFor="retry-attempts">
            <Input
              id="retry-attempts"
              type="number"
              min={1}
              max={5}
              value={config.retry.max_attempts}
              onChange={(e) =>
                onUpdate({
                  retry: { ...config.retry, max_attempts: Math.min(5, Math.max(1, Number(e.target.value))) },
                })
              }
            />
          </FieldGroup>

          <FieldGroup label="Backoff strategy" htmlFor="retry-backoff">
            <Select
              id="retry-backoff"
              value={config.retry.backoff}
              onChange={(e) =>
                onUpdate({
                  retry: { ...config.retry, backoff: e.target.value as "none" | "linear" | "exponential" },
                })
              }
            >
              <option value="none">None</option>
              <option value="linear">Linear</option>
              <option value="exponential">Exponential</option>
            </Select>
          </FieldGroup>

          {config.retry.backoff !== "none" && (
            <FieldGroup label="Base seconds" htmlFor="retry-base">
              <Input
                id="retry-base"
                type="number"
                min={0}
                value={config.retry.backoff_base_seconds}
                onChange={(e) =>
                  onUpdate({
                    retry: { ...config.retry, backoff_base_seconds: Number(e.target.value) },
                  })
                }
              />
            </FieldGroup>
          )}

          <Toggle
            id="retry-fail"
            checked={config.retry.fail_program_on_exhaust}
            onChange={(v) =>
              onUpdate({
                retry: { ...config.retry, fail_program_on_exhaust: v },
              })
            }
            label="Fail program when retries exhausted"
          />
        </div>
      )}
    </div>
  );
}

// ─── Trigger Config ───────────────────────────────────────────────────────────

function TriggerSidebar({
  config,
  onUpdate,
}: {
  config: TriggerConfig;
  onUpdate: (patch: Partial<TriggerConfig>) => void;
}) {
  return (
    <div className="space-y-3">
      <FieldGroup label="Trigger type" htmlFor="trigger-type">
        <Select
          id="trigger-type"
          value={config.trigger_type}
          onChange={(e) => {
            const t = e.target.value as TriggerConfig["trigger_type"];
            if (t === "manual") onUpdate({ trigger_type: "manual" } as TriggerConfig);
            else if (t === "cron") onUpdate({ trigger_type: "cron", expression: "", timezone: "UTC" } as TriggerConfig);
            else if (t === "webhook") onUpdate({ trigger_type: "webhook", endpoint_id: "", method: "POST" } as TriggerConfig);
            else if (t === "event") onUpdate({ trigger_type: "event", source: "", event: "", filter: null } as TriggerConfig);
            else if (t === "program_output") onUpdate({ trigger_type: "program_output", source_program_id: "", on_status: ["success"] } as TriggerConfig);
          }}
        >
          <option value="manual">Manual</option>
          <option value="cron">Cron Schedule</option>
          <option value="webhook">Webhook</option>
          <option value="event">Event</option>
          <option value="program_output">Program Output</option>
        </Select>
      </FieldGroup>

      {config.trigger_type === "cron" && (
        <>
          <FieldGroup label="Cron expression" htmlFor="cron-expr">
            <Input
              id="cron-expr"
              placeholder="0 9 * * 1-5"
              value={config.expression}
              onChange={(e) => onUpdate({ ...config, expression: e.target.value })}
            />
          </FieldGroup>
          <FieldGroup label="Timezone" htmlFor="cron-tz">
            <Input
              id="cron-tz"
              placeholder="UTC"
              value={config.timezone}
              onChange={(e) => onUpdate({ ...config, timezone: e.target.value })}
            />
          </FieldGroup>
        </>
      )}

      {config.trigger_type === "webhook" && (
        <FieldGroup label="HTTP method" htmlFor="webhook-method">
          <Select
            id="webhook-method"
            value={config.method}
            onChange={(e) =>
              onUpdate({ ...config, method: e.target.value as "POST" | "GET" })
            }
          >
            <option value="POST">POST</option>
            <option value="GET">GET</option>
          </Select>
        </FieldGroup>
      )}

      {config.trigger_type === "event" && (
        <>
          <FieldGroup label="Source" htmlFor="event-source">
            <Input
              id="event-source"
              placeholder="e.g. gmail"
              value={config.source}
              onChange={(e) => onUpdate({ ...config, source: e.target.value })}
            />
          </FieldGroup>
          <FieldGroup label="Event name" htmlFor="event-name">
            <Input
              id="event-name"
              placeholder="e.g. message.received"
              value={config.event}
              onChange={(e) => onUpdate({ ...config, event: e.target.value })}
            />
          </FieldGroup>
        </>
      )}

      {config.trigger_type === "program_output" && (
        <FieldGroup label="Source program ID" htmlFor="prog-source">
          <Input
            id="prog-source"
            placeholder="Program UUID"
            value={config.source_program_id}
            onChange={(e) => onUpdate({ ...config, source_program_id: e.target.value })}
          />
        </FieldGroup>
      )}
    </div>
  );
}

// ─── Step Config ──────────────────────────────────────────────────────────────

type StepTab = "logic";

function StepSidebar({
  config,
  onUpdate,
}: {
  config: StepConfig;
  onUpdate: (patch: Partial<StepConfig>) => void;
}) {
  const [newCondition, setNewCondition] = useState("");
  const [newCondTarget, setNewCondTarget] = useState("");

  return (
    <div className="space-y-3">
      <FieldGroup label="Logic type" htmlFor="step-logic">
        <Select
          id="step-logic"
          value={config.logic_type}
          onChange={(e) => {
            const t = e.target.value as StepConfig["logic_type"];
            if (t === "transform") onUpdate({ logic_type: "transform", transformation: "", input_schema: null, output_schema: null } as StepConfig);
            else if (t === "filter") onUpdate({ logic_type: "filter", condition: "", pass_schema: null } as StepConfig);
            else if (t === "branch") onUpdate({ logic_type: "branch", conditions: [], default_branch: "" } as StepConfig);
          }}
        >
          <option value="transform">Transform</option>
          <option value="filter">Filter</option>
          <option value="branch">Branch</option>
        </Select>
      </FieldGroup>

      {config.logic_type === "transform" && (
        <FieldGroup label="Transformation expression" htmlFor="step-transform">
          <Textarea
            id="step-transform"
            rows={6}
            placeholder="e.g. output.data.map(item => ({ id: item.id, name: item.name }))"
            value={config.transformation}
            onChange={(e) => onUpdate({ ...config, transformation: e.target.value })}
            className="text-xs resize-none font-mono"
          />
        </FieldGroup>
      )}

      {config.logic_type === "filter" && (
        <FieldGroup label="Filter condition" htmlFor="step-filter">
          <Input
            id="step-filter"
            placeholder="e.g. input.status === 'active'"
            value={config.condition}
            onChange={(e) => onUpdate({ ...config, condition: e.target.value })}
          />
        </FieldGroup>
      )}

      {config.logic_type === "branch" && (
        <>
          <div className="space-y-2">
            <Label className="text-xs">Branch conditions</Label>
            {config.conditions.map((cond: BranchCondition, i: number) => (
              <div key={i} className="flex gap-1.5 items-start">
                <div className="flex-1 space-y-1">
                  <Input
                    placeholder="Condition expression"
                    value={cond.condition}
                    onChange={(e) => {
                      const next = [...config.conditions];
                      next[i] = { ...next[i], condition: e.target.value };
                      onUpdate({ ...config, conditions: next });
                    }}
                    className="text-xs"
                  />
                  <Input
                    placeholder="Target node ID"
                    value={cond.target_node_id}
                    onChange={(e) => {
                      const next = [...config.conditions];
                      next[i] = { ...next[i], target_node_id: e.target.value };
                      onUpdate({ ...config, conditions: next });
                    }}
                    className="text-xs"
                  />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="mt-0.5 h-7 w-7 text-muted-foreground hover:text-destructive shrink-0"
                  onClick={() => {
                    const next = config.conditions.filter((_, j) => j !== i);
                    onUpdate({ ...config, conditions: next });
                  }}
                >
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={2} className="h-3.5 w-3.5">
                    <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
                  </svg>
                </Button>
              </div>
            ))}

            {/* Add new condition */}
            <div className="space-y-1.5 pt-1">
              <Input
                placeholder="New condition expression"
                value={newCondition}
                onChange={(e) => setNewCondition(e.target.value)}
                className="text-xs"
              />
              <Input
                placeholder="Target node ID"
                value={newCondTarget}
                onChange={(e) => setNewCondTarget(e.target.value)}
                className="text-xs"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full"
                disabled={!newCondition.trim() || !newCondTarget.trim()}
                onClick={() => {
                  onUpdate({
                    ...config,
                    conditions: [
                      ...config.conditions,
                      { condition: newCondition.trim(), target_node_id: newCondTarget.trim() },
                    ],
                  });
                  setNewCondition("");
                  setNewCondTarget("");
                }}
              >
                + Add condition
              </Button>
            </div>
          </div>

          <FieldGroup label="Default branch (node ID)" htmlFor="step-default">
            <Input
              id="step-default"
              placeholder="node-id"
              value={config.default_branch}
              onChange={(e) => onUpdate({ ...config, default_branch: e.target.value })}
            />
          </FieldGroup>
        </>
      )}
    </div>
  );
}

// ─── Connection Config ────────────────────────────────────────────────────────

function isHttpConnectionConfig(
  config: ConnectionConfig
): config is HttpConnectionConfig {
  return config.connector_type === "http";
}

function KeyValueListEditor({
  label,
  items,
  onChange,
  emptyKeyPlaceholder,
  emptyValuePlaceholder,
}: {
  label: string;
  items: Array<{ key: string; value: string }>;
  onChange: (next: Array<{ key: string; value: string }>) => void;
  emptyKeyPlaceholder: string;
  emptyValuePlaceholder: string;
}) {
  return (
    <div className="space-y-2">
      <Label className="text-xs">{label}</Label>
      {items.length === 0 && (
        <p className="text-[11px] text-muted-foreground">No entries yet.</p>
      )}
      {items.map((item, index) => (
        <div key={index} className="flex items-center gap-1.5">
          <Input
            value={item.key}
            placeholder={emptyKeyPlaceholder}
            className="text-xs"
            onChange={(e) => {
              const next = [...items];
              next[index] = { ...next[index], key: e.target.value };
              onChange(next);
            }}
          />
          <Input
            value={item.value}
            placeholder={emptyValuePlaceholder}
            className="text-xs"
            onChange={(e) => {
              const next = [...items];
              next[index] = { ...next[index], value: e.target.value };
              onChange(next);
            }}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-destructive shrink-0"
            onClick={() => onChange(items.filter((_, i) => i !== index))}
          >
            <svg
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              className="h-3.5 w-3.5"
            >
              <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
            </svg>
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-full"
        onClick={() => onChange([...items, { key: "", value: "" }])}
      >
        + Add entry
      </Button>
    </div>
  );
}

function ConnectionSidebar({
  config,
  onUpdate,
}: {
  config: ConnectionConfig;
  onUpdate: (patch: Record<string, unknown>) => void;
}) {
  const [newScope, setNewScope] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);

  if (!isHttpConnectionConfig(config)) {
    return (
      <div className="space-y-3">
        <FieldGroup label="Scope access" htmlFor="conn-scope">
          <Select
            id="conn-scope"
            value={config.scope_access}
            onChange={(e) =>
              onUpdate({ scope_access: e.target.value as "read" | "write" | "read_write" })
            }
          >
            <option value="read">Read</option>
            <option value="write">Write</option>
            <option value="read_write">Read + Write</option>
          </Select>
        </FieldGroup>

        <div className="space-y-2">
          <Label className="text-xs">Required scopes</Label>
          {config.scope_required.map((scope, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <span className="flex-1 rounded-md border border-border bg-muted px-2 py-1 text-xs">
                {scope}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground hover:text-destructive shrink-0"
                onClick={() => {
                  const next = config.scope_required.filter((_, j) => j !== i);
                  onUpdate({ scope_required: next });
                }}
              >
                <svg
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  className="h-3.5 w-3.5"
                >
                  <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
                </svg>
              </Button>
            </div>
          ))}

          <div className="flex gap-1.5">
            <Input
              placeholder="e.g. gmail.readonly"
              value={newScope}
              onChange={(e) => setNewScope(e.target.value)}
              className="text-xs"
              onKeyDown={(e) => {
                if (e.key === "Enter" && newScope.trim()) {
                  onUpdate({ scope_required: [...config.scope_required, newScope.trim()] });
                  setNewScope("");
                }
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!newScope.trim()}
              onClick={() => {
                if (!newScope.trim()) return;
                onUpdate({ scope_required: [...config.scope_required, newScope.trim()] });
                setNewScope("");
              }}
            >
              Add
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const retryConfig: RetryConfig =
    config.retry ?? {
      max_attempts: 3,
      backoff: "exponential",
      backoff_base_seconds: 5,
      fail_program_on_exhaust: false,
    };

  return (
    <div className="space-y-3">
      <FieldGroup label="Method" htmlFor="http-method">
        <Select
          id="http-method"
          value={config.method}
          onChange={(e) =>
            onUpdate({
              method: e.target.value as HttpConnectionConfig["method"],
            })
          }
        >
          <option value="GET">GET</option>
          <option value="POST">POST</option>
          <option value="PUT">PUT</option>
          <option value="PATCH">PATCH</option>
          <option value="DELETE">DELETE</option>
          <option value="HEAD">HEAD</option>
          <option value="OPTIONS">OPTIONS</option>
        </Select>
      </FieldGroup>

      <FieldGroup label="URL" htmlFor="http-url">
        <Input
          id="http-url"
          placeholder="https://api.example.com/v1/resource"
          value={config.url}
          onChange={(e) => onUpdate({ url: e.target.value })}
        />
      </FieldGroup>

      <FieldGroup label="Auth type" htmlFor="http-auth-type">
        <Select
          id="http-auth-type"
          value={config.auth_type}
          onChange={(e) =>
            onUpdate({
              auth_type: e.target.value as HttpConnectionConfig["auth_type"],
              auth_value: e.target.value === "none" ? null : config.auth_value,
            })
          }
        >
          <option value="none">None</option>
          <option value="bearer">Bearer token</option>
          <option value="basic">Basic (username:password)</option>
          <option value="api_key_header">API key (header)</option>
          <option value="api_key_query">API key (query param)</option>
        </Select>
      </FieldGroup>

      {config.auth_type !== "none" && (
        <FieldGroup label="Auth value" htmlFor="http-auth-value">
          <Input
            id="http-auth-value"
            placeholder={
              config.auth_type === "basic"
                ? "username:password"
                : "token-or-api-key"
            }
            value={config.auth_value ?? ""}
            onChange={(e) => onUpdate({ auth_value: e.target.value || null })}
          />
        </FieldGroup>
      )}

      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-full"
        onClick={() => setShowAdvanced((v) => !v)}
      >
        {showAdvanced ? "Hide advanced options" : "Show advanced options"}
      </Button>

      {showAdvanced && (
        <div className="space-y-3 rounded-md border border-border p-3">
          <KeyValueListEditor
            label="Query params"
            items={config.query_params}
            onChange={(next) => onUpdate({ query_params: next })}
            emptyKeyPlaceholder="key"
            emptyValuePlaceholder="value"
          />

          <KeyValueListEditor
            label="Headers"
            items={config.headers}
            onChange={(next) => onUpdate({ headers: next })}
            emptyKeyPlaceholder="Header-Name"
            emptyValuePlaceholder="Header value"
          />

          <FieldGroup label="Body" htmlFor="http-body">
            <Textarea
              id="http-body"
              rows={5}
              placeholder='{"example": "value"}'
              value={config.body ?? ""}
              onChange={(e) => onUpdate({ body: e.target.value || null })}
              className="text-xs font-mono resize-none"
            />
          </FieldGroup>

          <Toggle
            id="http-parse-response"
            checked={config.parse_response}
            onChange={(v) => onUpdate({ parse_response: v })}
            label="Parse response as JSON when possible"
          />

          <FieldGroup label="Timeout (seconds)" htmlFor="http-timeout">
            <Input
              id="http-timeout"
              type="number"
              min={1}
              placeholder="Default: 30"
              value={config.timeout_seconds ?? ""}
              onChange={(e) =>
                onUpdate({
                  timeout_seconds: e.target.value ? Number(e.target.value) : null,
                })
              }
            />
          </FieldGroup>

          <Toggle
            id="http-enable-retry"
            checked={config.retry !== null}
            onChange={(enabled) => onUpdate({ retry: enabled ? retryConfig : null })}
            label="Enable retries"
          />

          {config.retry !== null && (
            <div className="space-y-3 rounded-md border border-border p-2.5">
              <FieldGroup label="Max attempts (1-5)" htmlFor="http-retry-attempts">
                <Input
                  id="http-retry-attempts"
                  type="number"
                  min={1}
                  max={5}
                  value={retryConfig.max_attempts}
                  onChange={(e) =>
                    onUpdate({
                      retry: {
                        ...retryConfig,
                        max_attempts: Math.min(5, Math.max(1, Number(e.target.value))),
                      },
                    })
                  }
                />
              </FieldGroup>

              <FieldGroup label="Backoff strategy" htmlFor="http-retry-backoff">
                <Select
                  id="http-retry-backoff"
                  value={retryConfig.backoff}
                  onChange={(e) =>
                    onUpdate({
                      retry: {
                        ...retryConfig,
                        backoff: e.target.value as RetryConfig["backoff"],
                      },
                    })
                  }
                >
                  <option value="none">None</option>
                  <option value="linear">Linear</option>
                  <option value="exponential">Exponential</option>
                </Select>
              </FieldGroup>

              {retryConfig.backoff !== "none" && (
                <FieldGroup label="Backoff base seconds" htmlFor="http-retry-base">
                  <Input
                    id="http-retry-base"
                    type="number"
                    min={0}
                    value={retryConfig.backoff_base_seconds}
                    onChange={(e) =>
                      onUpdate({
                        retry: {
                          ...retryConfig,
                          backoff_base_seconds: Number(e.target.value),
                        },
                      })
                    }
                  />
                </FieldGroup>
              )}

              <Toggle
                id="http-retry-fail"
                checked={retryConfig.fail_program_on_exhaust}
                onChange={(v) =>
                  onUpdate({
                    retry: {
                      ...retryConfig,
                      fail_program_on_exhaust: v,
                    },
                  })
                }
                label="Fail program when retries exhausted"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── NodeSidebar ──────────────────────────────────────────────────────────────

export function NodeSidebar({ nodeId, schema, apiKeys, onUpdate, onClose }: NodeSidebarProps) {
  const node = schema.nodes.find((n) => n.id === nodeId);

  // Track local label/description edits before committing via onUpdate
  const [label, setLabel] = useState(node?.label ?? "");
  const [description, setDescription] = useState(node?.description ?? "");

  // Reset local state when nodeId changes
  useEffect(() => {
    setLabel(node?.label ?? "");
    setDescription(node?.description ?? "");
  }, [nodeId, node?.label, node?.description]);

  if (!node) return null;

  const errors = schema.nodes.length > 0
    ? [] // will be populated from validationResult passed via schema context
    : [];
  const warnings: ValidationWarning[] = [];

  function commitLabel() {
    if (label !== node?.label) onUpdate(nodeId, { label });
  }

  function commitDescription() {
    if (description !== node?.description) onUpdate(nodeId, { description });
  }

  function handleConfigUpdate(patch: Record<string, unknown>) {
    onUpdate(nodeId, patch);
  }

  const NODE_TYPE_LABEL: Record<string, string> = {
    trigger: "Trigger",
    agent: "Agent",
    step: "Step",
    connection: "Connection",
  };

  return (
    <aside
      className={cn(
        "fixed top-0 right-0 bottom-0 z-30 w-80",
        "bg-background border-l border-border shadow-xl",
        "flex flex-col",
        "transition-transform duration-200"
      )}
      style={{ top: 56 }} // below toolbar
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "inline-flex items-center rounded-sm px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
              node.type === "trigger" && "bg-green-500/15 text-green-700 dark:text-green-400",
              node.type === "agent" && "bg-purple-500/15 text-purple-700 dark:text-purple-400",
              node.type === "step" && "bg-blue-500/15 text-blue-700 dark:text-blue-400",
              node.type === "connection" && "bg-slate-500/15 text-slate-700 dark:text-slate-300"
            )}
          >
            {NODE_TYPE_LABEL[node.type]}
          </span>
          <span className="text-sm font-medium text-foreground truncate max-w-[160px]">
            {node.label}
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          aria-label="Close sidebar"
        >
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
            <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {/* Validation summary (populated from parent via validationResult) */}
        {/* Parent will pass errors/warnings when available */}

        {/* Label & Description — always shown */}
        <SidebarSection title="Identity">
          <FieldGroup label="Label" htmlFor="node-label">
            <Input
              id="node-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              onBlur={commitLabel}
              onKeyDown={(e) => e.key === "Enter" && commitLabel()}
            />
          </FieldGroup>
          <FieldGroup label="Description" htmlFor="node-desc">
            <Textarea
              id="node-desc"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onBlur={commitDescription}
              className="text-xs resize-none"
            />
          </FieldGroup>
        </SidebarSection>

        {/* Type-specific config */}
        <SidebarSection title="Configuration">
          {node.type === "agent" && (
            <AgentSidebar
              config={node.config as AgentConfig}
              apiKeys={apiKeys}
              onUpdate={(patch) => handleConfigUpdate(patch as Record<string, unknown>)}
            />
          )}
          {node.type === "trigger" && (
            <TriggerSidebar
              config={node.config as TriggerConfig}
              onUpdate={(patch) => handleConfigUpdate(patch as Record<string, unknown>)}
            />
          )}
          {node.type === "step" && (
            <StepSidebar
              config={node.config as StepConfig}
              onUpdate={(patch) => handleConfigUpdate(patch as Record<string, unknown>)}
            />
          )}
          {node.type === "connection" && (
            <ConnectionSidebar
              config={node.config as ConnectionConfig}
              onUpdate={handleConfigUpdate}
            />
          )}
        </SidebarSection>
      </div>
    </aside>
  );
}
