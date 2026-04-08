"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

interface DeleteProgramButtonProps {
  programId: string;
  programName: string;
  redirectTo?: string;
}

export function DeleteProgramButton({ programId, programName, redirectTo = "/dashboard" }: DeleteProgramButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleConfirm() {
    setOpen(false);
    setDeleting(true);
    try {
      await fetch(`/api/programs/${programId}`, { method: "DELETE" });
      router.push(redirectTo);
      router.refresh();
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <button
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(true); }}
        disabled={deleting}
        className="inline-flex items-center justify-center rounded-md p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 disabled:opacity-50 transition-colors"
        aria-label="Delete program"
        title="Delete program"
      >
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-4 w-4">
          <path strokeLinecap="round" strokeLinejoin="round" d="M2.5 4h11M5.5 4V2.5a1 1 0 011-1h3a1 1 0 011 1V4m2 0v9a1 1 0 01-1 1h-7a1 1 0 01-1-1V4h9z" />
        </svg>
      </button>

      <ConfirmDialog
        open={open}
        title={`Delete "${programName}"?`}
        description="This will permanently delete the program, all its runs, and version history. This cannot be undone."
        confirmLabel="Delete program"
        onConfirm={handleConfirm}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}
