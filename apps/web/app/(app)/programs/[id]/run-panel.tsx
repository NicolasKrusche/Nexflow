"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import type { PreFlightCheck, PreFlightRemediation } from "@/lib/validation/pre-flight";

type PreFlightResult = {
  result: { valid: boolean };
  checks: PreFlightCheck[];
};

type FixResponse = {
  validation?: PreFlightResult;
  error?: string;
};

const CHECK_LABELS: Record<string, string> = {
  PRE_001: "OAuth connections",
  PRE_002: "API keys",
  PRE_003: "Permissions & scopes",
  PRE_004: "Unassigned nodes",
  PRE_005: "Graph links",
};

function CheckIcon({ status }: { status: PreFlightCheck["status"] }) {
  if (status === "pass") {
    return (
      <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-green-500/15 text-green-600 dark:text-green-400">
        <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={2} className="h-3 w-3">
          <path strokeLinecap="round" strokeLinejoin="round" d="M2 6l3 3 5-5" />
        </svg>
      </span>
    );
  }

  if (status === "fail") {
    return (
      <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-destructive/15 text-destructive">
        <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={2} className="h-3 w-3">
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 3l6 6M9 3l-6 6" />
        </svg>
      </span>
    );
  }

  return (
    <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-muted text-muted-foreground text-xs">
      -
    </span>
  );
}

export function RunPanel({ programId }: { programId: string }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "checking" | "done" | "starting">("idle");
  const [preflight, setPreflight] = useState<PreFlightResult | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [applyingFixId, setApplyingFixId] = useState<string | null>(null);

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
      setFetchError("Network error - could not run pre-flight checks");
      setState("done");
    }
  }

  async function startRun() {
    setState("starting");
    setFetchError(null);

    try {
      const res = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ program_id: programId }),
      });

      if (res.ok) {
        const { run_id } = (await res.json()) as { run_id: string };
        router.push(`/programs/${programId}/runs/${run_id}`);
      } else {
        const err = await res.json().catch(() => ({}));
        setFetchError((err as { error?: string }).error ?? "Failed to start run");
        setState("done");
      }
    } catch {
      setFetchError("Network error - could not start run");
      setState("done");
    }
  }

  async function applyRemediation(remediation: PreFlightRemediation, failureId: string) {
    if (remediation.type === "navigate") {
      window.location.assign(remediation.href);
      return;
    }

    setApplyingFixId(failureId);
    setFetchError(null);

    try {
      const res = await fetch(`/api/programs/${programId}/preflight/fix`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ remediation }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setFetchError((err as { error?: string }).error ?? "Failed to apply fix");
        return;
      }

      const data = (await res.json()) as FixResponse;
      if (data.validation) {
        setPreflight(data.validation);
      } else {
        await runPreflight();
      }

      setState("done");
    } catch {
      setFetchError("Network error - could not apply this fix");
    } finally {
      setApplyingFixId(null);
    }
  }

  const allPassed = preflight?.result.valid === true;
  const failCount = preflight?.checks.filter((check) => check.status === "fail").length ?? 0;

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
          onClick={allPassed ? startRun : runPreflight}
          disabled={state === "checking" || state === "starting" || applyingFixId !== null}
          className={allPassed ? "bg-green-600 hover:bg-green-700 text-white" : ""}
        >
          {state === "checking" ? (
            <span className="flex items-center gap-2">
              <Spinner /> Checking...
            </span>
          ) : state === "starting" ? (
            <span className="flex items-center gap-2">
              <Spinner /> Starting...
            </span>
          ) : state === "done" && allPassed ? (
            "Run >"
          ) : state === "done" ? (
            "Re-check"
          ) : (
            "Check & Run"
          )}
        </Button>
      </div>

      {fetchError && <p className="text-xs text-destructive">{fetchError}</p>}

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

              {check.failures.map((failure, index) => {
                const failureId = `${check.code}-${index}`;
                const remediation = failure.remediation;
                const isApplying = applyingFixId === failureId;

                return (
                  <div key={failureId} className="ml-7 space-y-1.5">
                    <p className="text-xs text-destructive">{failure.message}</p>
                    <p className="text-xs text-muted-foreground">
                      {"->"} {failure.fix_suggestion}
                    </p>

                    {remediation && (
                      <div>
                        {remediation.type === "navigate" ? (
                          <a
                            href={remediation.href}
                            className="text-xs font-medium text-primary underline underline-offset-2 hover:opacity-80"
                          >
                            {remediation.label} {"->"}
                          </a>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs"
                            disabled={isApplying || state === "checking" || state === "starting"}
                            onClick={() => applyRemediation(remediation, failureId)}
                          >
                            {isApplying ? (
                              <span className="flex items-center gap-2">
                                <Spinner /> Applying...
                              </span>
                            ) : (
                              remediation.label
                            )}
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}

          {allPassed ? (
            <div className="rounded-md bg-green-500/10 border border-green-500/20 text-green-700 dark:text-green-400 px-3 py-2 text-xs mt-2">
              All checks passed. Click Run to execute this program.
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
