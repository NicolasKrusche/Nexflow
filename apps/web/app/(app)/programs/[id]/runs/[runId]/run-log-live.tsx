"use client";

import { useEffect, useRef, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import type { Node } from "@flowos/schema";

// ─── Types ────────────────────────────────────────────────────────────────────

type NodeExecutionRow = {
  id: string;
  node_id: string;
  status: string;
  input_payload: unknown;
  output_payload: unknown;
  error_message: string | null;
  retry_count: number | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDuration(start: string | null, end: string | null): string {
  if (!start) return "—";
  const startMs = new Date(start).getTime();
  const endMs = end ? new Date(end).getTime() : Date.now();
  const diff = endMs - startMs;
  if (diff < 1000) return `${diff}ms`;
  if (diff < 60000) return `${(diff / 1000).toFixed(1)}s`;
  return `${Math.floor(diff / 60000)}m ${Math.floor((diff % 60000) / 1000)}s`;
}

// ─── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const classes: Record<string, string> = {
    pending: "bg-muted text-muted-foreground",
    running: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400 animate-pulse",
    completed: "bg-green-500/15 text-green-700 dark:text-green-400",
    success: "bg-green-500/15 text-green-700 dark:text-green-400",
    failed: "bg-destructive/15 text-destructive",
    cancelled: "bg-muted text-muted-foreground",
    waiting_approval: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
    skipped: "bg-muted text-muted-foreground",
  };
  const cls = classes[status] ?? "bg-muted text-muted-foreground";
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${cls}`}>
      {status.replace(/_/g, " ")}
    </span>
  );
}

// ─── JSON collapsible viewer ──────────────────────────────────────────────────

function JsonViewer({ label, data }: { label: string; data: unknown }) {
  if (data == null) return null;
  return (
    <details className="mt-1">
      <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground select-none">
        {label}
      </summary>
      <pre className="mt-1 p-2 rounded bg-muted text-xs overflow-x-auto max-h-48">
        {JSON.stringify(data, null, 2)}
      </pre>
    </details>
  );
}

// ─── Main client component ────────────────────────────────────────────────────

const TERMINAL = new Set(["completed", "failed", "cancelled"]);
const POLL_INTERVAL_MS = 2000;

export function RunLogLive({
  runId,
  initialExecs,
  nodeMap,
  runStatus: initialRunStatus,
}: {
  runId: string;
  initialExecs: NodeExecutionRow[];
  nodeMap: Record<string, Node>;
  runStatus: string;
}) {
  const [execs, setExecs] = useState<NodeExecutionRow[]>(initialExecs);
  const [runStatus, setRunStatus] = useState(initialRunStatus);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const supabase = createBrowserClient();

  const isTerminal = TERMINAL.has(runStatus);

  // Merge incoming exec rows (insert or update)
  const mergeExec = (updated: NodeExecutionRow) =>
    setExecs((prev) => {
      const idx = prev.findIndex((e) => e.id === updated.id);
      if (idx === -1) return [...prev, updated].sort(
        (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      );
      const next = [...prev];
      next[idx] = updated;
      return next;
    });

  // Fetch all current node_executions from Supabase
  const fetchExecs = async () => {
    const { data } = await supabase
      .from("node_executions")
      .select("id, node_id, status, input_payload, output_payload, error_message, retry_count, started_at, completed_at, created_at")
      .eq("run_id", runId)
      .order("created_at", { ascending: true });
    if (data && data.length > 0) setExecs(data as NodeExecutionRow[]);
  };

  // Fetch current run status
  const fetchRunStatus = async () => {
    const { data } = await supabase
      .from("runs")
      .select("status")
      .eq("id", runId)
      .single();
    if (data?.status) setRunStatus(data.status as string);
  };

  useEffect(() => {
    // Always do an immediate fetch in case the page loaded before runtime wrote rows
    fetchExecs();
    fetchRunStatus();

    if (isTerminal) return;

    // ── Realtime subscriptions ─────────────────────────────────────────────
    const channel = supabase
      .channel(`run-log-${runId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "node_executions", filter: `run_id=eq.${runId}` },
        (payload) => mergeExec(payload.new as NodeExecutionRow)
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "runs", filter: `id=eq.${runId}` },
        (payload) => {
          const updated = payload.new as { status: string };
          setRunStatus(updated.status);
        }
      )
      .subscribe();

    // ── Polling fallback (in case Realtime isn't enabled on the table) ─────
    pollRef.current = setInterval(async () => {
      await fetchExecs();
      await fetchRunStatus();
    }, POLL_INTERVAL_MS);

    return () => {
      supabase.removeChannel(channel);
      if (pollRef.current) clearInterval(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);

  // Stop polling once terminal
  useEffect(() => {
    if (isTerminal && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
      // Final fetch to make sure we have the complete picture
      fetchExecs();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTerminal]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <h2 className="text-base font-medium">Node executions</h2>
        <StatusBadge status={runStatus} />
      </div>

      {execs.length === 0 ? (
        <div className="text-sm text-muted-foreground">
          {isTerminal ? "No node executions recorded." : "Waiting for execution to start…"}
        </div>
      ) : (
        <div className="space-y-2">
          {execs.map((exec) => {
            const node = nodeMap[exec.node_id];
            const label = node?.label ?? exec.node_id;
            const duration = formatDuration(exec.started_at, exec.completed_at);

            return (
              <div
                key={exec.id}
                className="rounded-lg border border-border p-4 space-y-2"
              >
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-2">
                    <StatusBadge status={exec.status} />
                    <span className="text-sm font-medium">{label}</span>
                    {node && (
                      <span className="text-xs text-muted-foreground">
                        ({node.type})
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground shrink-0">
                    {exec.started_at
                      ? `${new Date(exec.started_at).toLocaleTimeString()} · ${duration}`
                      : "—"}
                  </div>
                </div>

                {exec.error_message && (
                  <p className="text-xs text-destructive font-mono">
                    {exec.error_message}
                  </p>
                )}

                {exec.retry_count != null && exec.retry_count > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Retried {exec.retry_count} time{exec.retry_count !== 1 ? "s" : ""}
                  </p>
                )}

                <JsonViewer label="Input" data={exec.input_payload} />
                <JsonViewer label="Output" data={exec.output_payload} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
