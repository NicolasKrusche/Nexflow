"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

// ─── Types ────────────────────────────────────────────────────────────────────

type ApprovalRow = {
  id: string;
  node_execution_id: string;
  user_id: string;
  status: string;
  context: {
    node_label?: string;
    input?: unknown;
    program_id?: string;
  } | null;
  decision_note: string | null;
  decided_at: string | null;
  created_at: string;
  node_executions: {
    id: string;
    node_id: string;
    run_id: string;
    runs: {
      id: string;
      program_id: string;
      programs: {
        id: string;
        name: string;
      };
    };
  };
};

// ─── Component ────────────────────────────────────────────────────────────────

export function ApprovalCard({ approval }: { approval: ApprovalRow }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState<"approved" | "rejected" | null>(null);
  const [decided, setDecided] = useState<"approved" | "rejected" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const programName =
    approval.node_executions?.runs?.programs?.name ?? "Unknown program";
  const runId = approval.node_executions?.run_id;
  const programId = approval.node_executions?.runs?.program_id;
  const nodeLabel = approval.context?.node_label ?? approval.node_executions?.node_id;

  async function decide(decision: "approved" | "rejected") {
    setSubmitting(decision);
    setError(null);
    try {
      const res = await fetch(`/api/approvals/${approval.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, note: note.trim() || undefined }),
      });
      if (res.ok) {
        setDecided(decision);
        router.refresh();
      } else {
        const body = await res.json().catch(() => ({}));
        setError((body as { error?: string }).error ?? "Failed to submit decision");
      }
    } catch {
      setError("Network error — could not submit decision");
    } finally {
      setSubmitting(null);
    }
  }

  if (decided) {
    return (
      <div className="rounded-lg border border-border p-4">
        <p className="text-sm">
          <span
            className={
              decided === "approved"
                ? "text-green-600 dark:text-green-400 font-medium"
                : "text-destructive font-medium"
            }
          >
            {decided === "approved" ? "Approved" : "Rejected"}
          </span>{" "}
          — thank you.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border p-5 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium">{nodeLabel}</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Program:{" "}
            {programId ? (
              <Link
                href={`/programs/${programId}`}
                className="hover:underline"
              >
                {programName}
              </Link>
            ) : (
              programName
            )}
            {runId && programId && (
              <>
                {" · "}
                <Link
                  href={`/programs/${programId}/runs/${runId}`}
                  className="hover:underline"
                >
                  View run
                </Link>
              </>
            )}
          </p>
        </div>
        <span className="text-xs text-muted-foreground shrink-0">
          {new Date(approval.created_at).toLocaleString()}
        </span>
      </div>

      {/* Context / input for review */}
      {approval.context?.input != null && (
        <details>
          <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground select-none">
            Input context
          </summary>
          <pre className="mt-1 p-2 rounded bg-muted text-xs overflow-x-auto max-h-48">
            {JSON.stringify(approval.context.input, null, 2)}
          </pre>
        </details>
      )}

      {/* Note textarea */}
      <div>
        <label className="block text-xs text-muted-foreground mb-1">
          Note (optional)
        </label>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Add a note for your decision…"
          rows={2}
          className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
        />
      </div>

      {/* Error */}
      {error && <p className="text-xs text-destructive">{error}</p>}

      {/* Action buttons */}
      <div className="flex gap-2">
        <Button
          onClick={() => decide("approved")}
          disabled={submitting !== null}
          className="bg-green-600 hover:bg-green-700 text-white"
        >
          {submitting === "approved" ? "Approving…" : "Approve"}
        </Button>
        <Button
          variant="outline"
          onClick={() => decide("rejected")}
          disabled={submitting !== null}
          className="border-destructive text-destructive hover:bg-destructive/10"
        >
          {submitting === "rejected" ? "Rejecting…" : "Reject"}
        </Button>
      </div>
    </div>
  );
}
