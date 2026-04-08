"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type ConflictEntry = {
  program: { id: string; name: string; is_active: boolean; execution_mode: string };
  shared_connections: Array<{ id: string; name: string; provider: string }>;
};

type Props = {
  programId: string;
  conflictPolicy: string;
  conflicts: ConflictEntry[];
};

const POLICY_INFO: Record<string, { label: string; description: string; color: string }> = {
  queue: {
    label: "Queue",
    description: "New runs wait until the current run finishes before starting.",
    color: "border-blue-500 bg-blue-500/10 text-blue-700 dark:text-blue-400",
  },
  skip: {
    label: "Skip",
    description: "New runs are silently discarded if another run is already active.",
    color: "border-yellow-500 bg-yellow-500/10 text-yellow-700 dark:text-yellow-400",
  },
  fail: {
    label: "Fail",
    description: "New runs immediately fail with a conflict error if another is active.",
    color: "border-destructive bg-destructive/10 text-destructive",
  },
};

export function ConflictResolutionPanel({ programId, conflictPolicy, conflicts }: Props) {
  const router = useRouter();
  const [policy, setPolicy] = useState(conflictPolicy);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const isDirty = policy !== conflictPolicy;

  const handleSave = () => {
    setError(null);
    startTransition(async () => {
      const res = await fetch(`/api/programs/${programId}/execution-mode`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conflict_policy: policy }),
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
    <div className="space-y-6">
      {/* Policy selector */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Concurrent Run Policy</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            {(["queue", "skip", "fail"] as const).map((p) => {
              const info = POLICY_INFO[p];
              return (
                <button
                  key={p}
                  onClick={() => setPolicy(p)}
                  className={`rounded-lg border-2 px-3 py-3 text-left transition-all ${
                    policy === p
                      ? info.color
                      : "border-border hover:bg-accent"
                  }`}
                >
                  <p className="text-sm font-semibold">{info.label}</p>
                  <p className="text-xs mt-1 opacity-80">{info.description}</p>
                </button>
              );
            })}
          </div>

          {isDirty && (
            <div className="flex items-center gap-3 pt-2">
              <button
                onClick={handleSave}
                disabled={isPending}
                className="h-8 px-3 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                {isPending ? "Saving…" : saved ? "Saved!" : "Save Policy"}
              </button>
              {error && <p className="text-xs text-destructive">{error}</p>}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Conflict list */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Conflicting Programs</CardTitle>
        </CardHeader>
        <CardContent>
          {conflicts.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No other programs share connections with this one.
            </p>
          ) : (
            <div className="divide-y divide-border">
              {conflicts.map(({ program: conflictProg, shared_connections }) => (
                <div key={conflictProg.id} className="py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <Link
                        href={`/programs/${conflictProg.id}`}
                        className="text-sm font-medium hover:underline"
                      >
                        {conflictProg.name}
                      </Link>
                      <p className="text-xs text-muted-foreground mt-0.5 capitalize">
                        {conflictProg.execution_mode} mode ·{" "}
                        <span
                          className={conflictProg.is_active ? "text-green-600" : "text-muted-foreground"}
                        >
                          {conflictProg.is_active ? "active" : "inactive"}
                        </span>
                      </p>
                    </div>
                    <Link
                      href={`/programs/${conflictProg.id}/conflicts`}
                      className="text-xs text-muted-foreground hover:text-foreground shrink-0"
                    >
                      View its policy →
                    </Link>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {shared_connections.map((conn) => (
                      <span
                        key={conn.id}
                        className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-xs"
                      >
                        <span className="capitalize text-muted-foreground">{conn.provider}</span>
                        <span>·</span>
                        <span>{conn.name}</span>
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* What happens note */}
      <div className="rounded-lg bg-muted p-4 text-xs text-muted-foreground space-y-1">
        <p className="font-medium text-foreground text-sm">How conflict detection works</p>
        <p>
          Before a run starts, FlowOS checks if any other program runs are currently active that
          share the same connections. If a conflict is detected, your chosen policy determines
          what happens next.
        </p>
        <p>
          Resource locks are automatically released when a run completes, fails, or is cancelled.
          Stale locks (runs that crashed without cleanup) expire after 30 minutes.
        </p>
      </div>
    </div>
  );
}
