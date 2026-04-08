"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

// ─── Types ────────────────────────────────────────────────────────────────────

type TriggerRow = {
  id: string;
  program_id: string;
  type: string;
  config: Record<string, unknown>;
  is_active: boolean;
  webhook_url: string | null;
  next_run_at: string | null;
  last_fired_at: string | null;
  created_at: string;
};

type Props = {
  programId: string;
  initialTriggers: TriggerRow[];
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

const TRIGGER_LABELS: Record<string, string> = {
  manual: "Manual",
  cron: "Scheduled (Cron)",
  webhook: "Inbound Webhook",
  event: "Event",
  program: "Program Output",
};

const TYPE_COLORS: Record<string, string> = {
  manual: "bg-muted text-muted-foreground",
  cron: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  webhook: "bg-purple-500/15 text-purple-700 dark:text-purple-400",
  event: "bg-orange-500/15 text-orange-700 dark:text-orange-400",
  program: "bg-green-500/15 text-green-700 dark:text-green-400",
};

// ─── New Trigger Form ─────────────────────────────────────────────────────────

function NewTriggerForm({
  programId,
  onCreated,
}: {
  programId: string;
  onCreated: (t: TriggerRow) => void;
}) {
  const [type, setType] = useState("manual");
  const [cronExpr, setCronExpr] = useState("0 9 * * 1-5");
  const [cronTz, setCronTz] = useState("UTC");
  const [sourceProgramId, setSourceProgramId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    let config: Record<string, unknown> = {};
    if (type === "cron") {
      config = { trigger_type: "cron", expression: cronExpr, timezone: cronTz };
    } else if (type === "webhook") {
      config = { trigger_type: "webhook" };
    } else if (type === "program") {
      if (!sourceProgramId.trim()) {
        setError("Source program ID is required");
        return;
      }
      config = { trigger_type: "program_output", source_program_id: sourceProgramId.trim() };
    } else if (type === "manual") {
      config = { trigger_type: "manual" };
    } else if (type === "event") {
      config = { trigger_type: "event" };
    }

    startTransition(async () => {
      const res = await fetch(`/api/programs/${programId}/triggers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, config }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError((data as { error?: string }).error ?? "Failed to create trigger");
        return;
      }
      const data = await res.json() as { trigger: TriggerRow };
      onCreated(data.trigger);
      // Reset form
      setType("manual");
      setCronExpr("0 9 * * 1-5");
      setSourceProgramId("");
    });
  };

  return (
    <form onSubmit={handleSubmit} className="rounded-lg border border-border p-4 space-y-4 bg-card">
      <h3 className="text-sm font-medium">Add Trigger</h3>

      {/* Type selector */}
      <div>
        <label className="block text-xs text-muted-foreground mb-1.5">Type</label>
        <select
          value={type}
          onChange={(e) => setType(e.target.value)}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
        >
          <option value="manual">Manual (button only)</option>
          <option value="cron">Scheduled (Cron)</option>
          <option value="webhook">Inbound Webhook</option>
          <option value="event">Event</option>
          <option value="program">Program Output (chain)</option>
        </select>
      </div>

      {/* Cron fields */}
      {type === "cron" && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-muted-foreground mb-1.5">
              Cron expression
            </label>
            <input
              type="text"
              value={cronExpr}
              onChange={(e) => setCronExpr(e.target.value)}
              placeholder="0 9 * * 1-5"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-mono"
            />
            <p className="text-xs text-muted-foreground mt-1">
              e.g. <code className="font-mono">0 9 * * 1-5</code> = weekdays at 9am
            </p>
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-1.5">Timezone</label>
            <input
              type="text"
              value={cronTz}
              onChange={(e) => setCronTz(e.target.value)}
              placeholder="UTC"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
          </div>
        </div>
      )}

      {/* Program chain fields */}
      {type === "program" && (
        <div>
          <label className="block text-xs text-muted-foreground mb-1.5">
            Source Program ID
          </label>
          <input
            type="text"
            value={sourceProgramId}
            onChange={(e) => setSourceProgramId(e.target.value)}
            placeholder="UUID of the upstream program"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-mono"
          />
          <p className="text-xs text-muted-foreground mt-1">
            This program will run automatically when the source program completes.
          </p>
        </div>
      )}

      {/* Webhook info */}
      {type === "webhook" && (
        <p className="text-xs text-muted-foreground bg-muted rounded p-2">
          A unique webhook URL will be generated. You can copy it after creation.
        </p>
      )}

      {error && (
        <p className="text-xs text-destructive">{error}</p>
      )}

      <button
        type="submit"
        disabled={isPending}
        className="h-9 px-4 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
      >
        {isPending ? "Creating…" : "Create Trigger"}
      </button>
    </form>
  );
}

// ─── Trigger Card ─────────────────────────────────────────────────────────────

function TriggerCard({
  trigger,
  programId,
  onToggle,
  onDelete,
}: {
  trigger: TriggerRow;
  programId: string;
  onToggle: (id: string, active: boolean) => void;
  onDelete: (id: string) => void;
}) {
  const [isDeleting, startDelete] = useTransition();
  const [isToggling, startToggle] = useTransition();
  const [copied, setCopied] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const handleToggle = () => {
    startToggle(async () => {
      await fetch(`/api/programs/${programId}/triggers/${trigger.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: !trigger.is_active }),
      });
      onToggle(trigger.id, !trigger.is_active);
    });
  };

  const handleDelete = () => setDeleteOpen(true);

  const confirmDelete = () => {
    setDeleteOpen(false);
    startDelete(async () => {
      await fetch(`/api/programs/${programId}/triggers/${trigger.id}`, {
        method: "DELETE",
      });
      onDelete(trigger.id);
    });
  };

  const handleCopyWebhook = async () => {
    if (!trigger.webhook_url) return;
    await navigator.clipboard.writeText(trigger.webhook_url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <>
    <ConfirmDialog
      open={deleteOpen}
      title="Delete trigger?"
      description="This trigger will be permanently deleted and will no longer fire."
      confirmLabel="Delete"
      onConfirm={confirmDelete}
      onCancel={() => setDeleteOpen(false)}
    />
    <div className={`rounded-lg border p-4 space-y-3 transition-opacity ${trigger.is_active ? "border-border" : "border-border opacity-60"}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${TYPE_COLORS[trigger.type] ?? "bg-muted text-muted-foreground"}`}
          >
            {TRIGGER_LABELS[trigger.type] ?? trigger.type}
          </span>
          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${trigger.is_active ? "bg-green-500/15 text-green-700 dark:text-green-400" : "bg-muted text-muted-foreground"}`}
          >
            {trigger.is_active ? "Active" : "Paused"}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={handleToggle}
            disabled={isToggling}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
          >
            {trigger.is_active ? "Pause" : "Enable"}
          </button>
          <button
            onClick={handleDelete}
            disabled={isDeleting}
            className="text-xs text-destructive hover:text-destructive/80 transition-colors disabled:opacity-50"
          >
            Delete
          </button>
        </div>
      </div>

      {/* Config details */}
      <div className="text-xs text-muted-foreground space-y-1">
        {trigger.type === "cron" && (
          <>
            <p>
              <span className="text-foreground font-mono">{trigger.config.expression as string}</span>
              {" "}({(trigger.config.timezone as string) ?? "UTC"})
            </p>
            <p>Next run: {formatDateTime(trigger.next_run_at)}</p>
            <p>Last fired: {formatDateTime(trigger.last_fired_at)}</p>
          </>
        )}

        {trigger.type === "webhook" && trigger.webhook_url && (
          <div className="flex items-center gap-2">
            <code className="font-mono bg-muted rounded px-2 py-1 text-xs flex-1 overflow-x-auto">
              {trigger.webhook_url}
            </code>
            <button
              onClick={handleCopyWebhook}
              className="shrink-0 text-xs px-2 py-1 rounded bg-muted hover:bg-muted/80 transition-colors"
            >
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
        )}

        {trigger.type === "program" && (
          <p>
            Source: <code className="font-mono">{trigger.config.source_program_id as string}</code>
          </p>
        )}

        {trigger.type === "manual" && (
          <p>Runs only when manually triggered from the program page.</p>
        )}

        {trigger.type === "event" && (
          <p>Event-driven trigger (configure via the editor).</p>
        )}

        {(trigger.type === "webhook" || trigger.type === "program") && trigger.last_fired_at && (
          <p>Last fired: {formatDateTime(trigger.last_fired_at)}</p>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Created {formatDateTime(trigger.created_at)}
      </p>
    </div>
    </>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function TriggerManager({ programId, initialTriggers }: Props) {
  const router = useRouter();
  const [triggers, setTriggers] = useState<TriggerRow[]>(initialTriggers);
  const [showForm, setShowForm] = useState(false);

  const handleCreated = (trigger: TriggerRow) => {
    setTriggers((prev) => [trigger, ...prev]);
    setShowForm(false);
  };

  const handleToggle = (id: string, active: boolean) => {
    setTriggers((prev) =>
      prev.map((t) => (t.id === id ? { ...t, is_active: active } : t))
    );
  };

  const handleDelete = (id: string) => {
    setTriggers((prev) => prev.filter((t) => t.id !== id));
  };

  return (
    <div className="space-y-4">
      {/* Add trigger button */}
      <div className="flex justify-end">
        <button
          onClick={() => setShowForm((s) => !s)}
          className="h-9 px-4 text-sm font-medium rounded-md border border-border bg-background hover:bg-accent transition-colors"
        >
          {showForm ? "Cancel" : "+ Add Trigger"}
        </button>
      </div>

      {showForm && (
        <NewTriggerForm programId={programId} onCreated={handleCreated} />
      )}

      {triggers.length === 0 && !showForm ? (
        <div className="rounded-lg border border-border p-8 text-center">
          <p className="text-sm text-muted-foreground">
            No triggers configured. Add one to automate this program.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {triggers.map((t) => (
            <TriggerCard
              key={t.id}
              trigger={t}
              programId={programId}
              onToggle={handleToggle}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}
