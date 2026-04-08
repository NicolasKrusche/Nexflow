"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

export function StopRunButton({ runId }: { runId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [stopping, setStopping] = useState(false);

  async function handleConfirm() {
    setOpen(false);
    setStopping(true);
    try {
      await fetch(`/api/runs/${runId}/cancel`, { method: "POST" });
      router.refresh();
    } finally {
      setStopping(false);
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        disabled={stopping}
        className="inline-flex items-center gap-1.5 rounded-md border border-destructive/50 px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        <svg viewBox="0 0 16 16" fill="currentColor" className="h-3 w-3">
          <rect x="3" y="3" width="10" height="10" rx="1.5" />
        </svg>
        {stopping ? "Stopping…" : "Force stop"}
      </button>

      <ConfirmDialog
        open={open}
        title="Force stop run?"
        description="The run will be marked as cancelled immediately and all resource locks will be released."
        confirmLabel="Force stop"
        onConfirm={handleConfirm}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}
