"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Props = {
  programId: string;
  executionMode: string;
  conflictPolicy: string;
};

const MODE_DESCRIPTIONS: Record<string, string> = {
  autonomous: "Runs fully automatically — no approvals required (except nodes explicitly marked).",
  supervised: "Every agent node requires manual approval before executing.",
  manual: "Step-through mode — you advance each node manually.",
};

const POLICY_DESCRIPTIONS: Record<string, string> = {
  queue: "New runs wait in queue if another is already running.",
  skip: "New runs are skipped if another is already running.",
  fail: "New runs fail immediately if another is already running.",
};

export function ExecutionControls({ programId, executionMode, conflictPolicy }: Props) {
  const router = useRouter();
  const [mode, setMode] = useState(executionMode);
  const [policy, setPolicy] = useState(conflictPolicy);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const isDirty = mode !== executionMode || policy !== conflictPolicy;

  const handleSave = () => {
    setError(null);
    startTransition(async () => {
      const res = await fetch(`/api/programs/${programId}/execution-mode`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ execution_mode: mode, conflict_policy: policy }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError((data as { error?: string }).error ?? "Save failed");
        return;
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      router.refresh();
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Execution Controls</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Execution mode */}
        <div>
          <label className="block text-xs font-medium text-foreground mb-2">Execution Mode</label>
          <div className="grid grid-cols-3 gap-2">
            {(["autonomous", "supervised", "manual"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`rounded-lg border px-3 py-2.5 text-left transition-colors ${
                  mode === m
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border hover:bg-accent"
                }`}
              >
                <p className="text-xs font-medium capitalize">{m}</p>
              </button>
            ))}
          </div>
          {MODE_DESCRIPTIONS[mode] && (
            <p className="text-xs text-muted-foreground mt-2">{MODE_DESCRIPTIONS[mode]}</p>
          )}
        </div>

        {/* Conflict policy */}
        <div>
          <label className="block text-xs font-medium text-foreground mb-2">
            Concurrent Run Policy
          </label>
          <div className="grid grid-cols-3 gap-2">
            {(["queue", "skip", "fail"] as const).map((p) => (
              <button
                key={p}
                onClick={() => setPolicy(p)}
                className={`rounded-lg border px-3 py-2.5 text-left transition-colors ${
                  policy === p
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border hover:bg-accent"
                }`}
              >
                <p className="text-xs font-medium capitalize">{p}</p>
              </button>
            ))}
          </div>
          {POLICY_DESCRIPTIONS[policy] && (
            <p className="text-xs text-muted-foreground mt-2">{POLICY_DESCRIPTIONS[policy]}</p>
          )}
        </div>

        {/* Save */}
        {(isDirty || saved || error) && (
          <div className="flex items-center gap-3">
            <button
              onClick={handleSave}
              disabled={isPending || !isDirty}
              className="h-8 px-3 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {isPending ? "Saving…" : saved ? "Saved!" : "Save Changes"}
            </button>
            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
