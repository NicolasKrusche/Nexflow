"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { PreFlightCheck } from "@/lib/validation/pre-flight";

type PreFlightResult = {
  result: { valid: boolean };
  checks: PreFlightCheck[];
};

const CHECK_LABELS: Record<string, string> = {
  PRE_001: "OAuth connections",
  PRE_002: "API keys",
  PRE_003: "Permissions & scopes",
  PRE_004: "Unassigned nodes",
};

function CheckIcon({ status }: { status: PreFlightCheck["status"] }) {
  if (status === "pass")
    return (
      <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-green-500/15 text-green-600 dark:text-green-400 text-xs font-bold">
        ✓
      </span>
    );
  if (status === "fail")
    return (
      <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-destructive/15 text-destructive text-xs font-bold">
        ✕
      </span>
    );
  return (
    <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-muted text-muted-foreground text-xs">
      –
    </span>
  );
}

export function RunPanel({ programId }: { programId: string }) {
  const [state, setState] = useState<"idle" | "checking" | "done">("idle");
  const [preflight, setPreflight] = useState<PreFlightResult | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  async function runPreflight() {
    setState("checking");
    setFetchError(null);
    setPreflight(null);

    try {
      const res = await fetch(`/api/programs/${programId}/preflight`, {
        method: "POST",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setFetchError((err as { error?: string }).error ?? "Pre-flight check failed");
        setState("done");
        return;
      }
      const data: PreFlightResult = await res.json();
      setPreflight(data);
      setState("done");
    } catch {
      setFetchError("Network error — could not run pre-flight checks");
      setState("done");
    }
  }

  const allPassed = preflight?.result.valid === true;
  const failCount = preflight?.checks.filter((c) => c.status === "fail").length ?? 0;

  return (
    <div className="rounded-lg border border-border p-4 space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium">Run program</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Pre-flight checks verify connections, keys, and node configuration before execution.
          </p>
        </div>
        <Button
          onClick={runPreflight}
          disabled={state === "checking"}
          className={allPassed ? "bg-green-600 hover:bg-green-700 text-white" : ""}
        >
          {state === "checking" ? (
            <span className="flex items-center gap-2">
              <Spinner /> Checking…
            </span>
          ) : state === "done" && allPassed ? (
            "Run ▶"
          ) : state === "done" ? (
            "Re-check"
          ) : (
            "Check & Run"
          )}
        </Button>
      </div>

      {/* Error fetching */}
      {fetchError && (
        <p className="text-xs text-destructive">{fetchError}</p>
      )}

      {/* Pre-flight checklist */}
      {preflight && (
        <div className="space-y-2">
          {preflight.checks.map((check) => (
            <div key={check.code} className="space-y-1">
              <div className="flex items-center gap-2">
                <CheckIcon status={check.status} />
                <span className="text-sm">{CHECK_LABELS[check.code] ?? check.label}</span>
                {check.status === "skip" && (
                  <span className="text-xs text-muted-foreground">(not configured)</span>
                )}
              </div>
              {check.failures.map((f, i) => (
                <div key={i} className="ml-7 space-y-0.5">
                  <p className="text-xs text-destructive">{f.message}</p>
                  <p className="text-xs text-muted-foreground">→ {f.fix_suggestion}</p>
                </div>
              ))}
            </div>
          ))}

          {/* Summary */}
          {allPassed ? (
            <div className="rounded-md bg-green-500/10 border border-green-500/20 text-green-700 dark:text-green-400 px-3 py-2 text-xs mt-2">
              All checks passed. Click Run to execute this program.
              <span className="block text-[11px] opacity-70 mt-0.5">
                Execution engine coming in Phase 3.
              </span>
            </div>
          ) : (
            <div className="rounded-md bg-destructive/10 border border-destructive/20 text-destructive px-3 py-2 text-xs mt-2">
              {failCount} check{failCount !== 1 ? "s" : ""} failed. Fix the issues above before running.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Spinner() {
  return (
    <svg className="animate-spin w-3 h-3" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}
