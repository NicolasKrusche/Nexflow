"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

type PublishState = {
  is_public: boolean;
  tags: string[];
  fork_count: number;
  published_at: string | null;
  public_author_name: string | null;
};

export function PublishPanel({
  programId,
  initialState,
  hasSuccessfulRun,
}: {
  programId: string;
  initialState: PublishState;
  hasSuccessfulRun: boolean;
}) {
  const [state, setState] = useState<PublishState>(initialState);
  const [tagInput, setTagInput] = useState(initialState.tags.join(", "));
  const [authorInput, setAuthorInput] = useState(initialState.public_author_name ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  function parseTags(raw: string): string[] {
    return raw
      .split(",")
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean)
      .slice(0, 5);
  }

  async function handleToggle(publish: boolean) {
    setSaving(true);
    setError(null);
    setSuccess(false);

    const tags = parseTags(tagInput);
    const body: Record<string, unknown> = {
      publish,
      tags,
      public_author_name: authorInput.trim() || null,
    };

    try {
      const res = await fetch(`/api/programs/${programId}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = (await res.json()) as { program?: PublishState; error?: string };

      if (!res.ok) {
        setError(data.error ?? "Something went wrong");
        return;
      }

      if (data.program) setState(data.program);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch {
      setError("Network error — please try again");
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveSettings() {
    await handleToggle(state.is_public);
  }

  return (
    <div className="rounded-lg border border-border p-5 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold">Publish to Browse</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Share this program with the community. Your API keys are never included.
          </p>
        </div>
        <div className="shrink-0">
          {state.is_public ? (
            <Badge variant="success" className="text-xs">Published</Badge>
          ) : (
            <Badge variant="secondary" className="text-xs">Private</Badge>
          )}
        </div>
      </div>

      {/* Gate: no successful run */}
      {!hasSuccessfulRun && !state.is_public && (
        <div className="rounded-md bg-muted px-4 py-3 text-xs text-muted-foreground">
          This program needs at least one successful run before it can be published.
        </div>
      )}

      {/* Settings (always visible so they can prep before publishing) */}
      <div className="space-y-3">
        <div className="space-y-1">
          <label className="text-xs font-medium">Tags</label>
          <Input
            placeholder="notion, gmail, ai, daily (max 5)"
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            className="text-sm h-8"
          />
          <p className="text-[10px] text-muted-foreground">Comma-separated, lowercase, max 32 chars each</p>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium">Display name <span className="text-muted-foreground">(optional)</span></label>
          <Input
            placeholder="Your name or handle"
            value={authorInput}
            onChange={(e) => setAuthorInput(e.target.value)}
            className="text-sm h-8"
            maxLength={64}
          />
        </div>
      </div>

      {/* Preview of tags */}
      {parseTags(tagInput).length > 0 && (
        <div className="flex flex-wrap gap-1">
          {parseTags(tagInput).map((tag) => (
            <Badge key={tag} variant="secondary" className="text-[10px]">{tag}</Badge>
          ))}
        </div>
      )}

      {/* Error / success */}
      {error && (
        <p className="text-xs text-destructive">{error}</p>
      )}
      {success && (
        <p className="text-xs text-green-600 dark:text-green-400">
          {state.is_public ? "Published! Your program is now visible in Browse." : "Unpublished."}
        </p>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2 flex-wrap">
        {state.is_public ? (
          <>
            <Button
              size="sm"
              variant="outline"
              onClick={handleSaveSettings}
              disabled={saving}
            >
              {saving ? "Saving…" : "Save settings"}
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => handleToggle(false)}
              disabled={saving}
            >
              {saving ? "Saving…" : "Unpublish"}
            </Button>
            <span className="text-xs text-muted-foreground ml-1">
              {state.fork_count} fork{state.fork_count !== 1 ? "s" : ""}
            </span>
          </>
        ) : (
          <Button
            size="sm"
            onClick={() => handleToggle(true)}
            disabled={saving || !hasSuccessfulRun}
          >
            {saving ? "Publishing…" : "Publish program"}
          </Button>
        )}
      </div>

      {/* Link to browse once published */}
      {state.is_public && (
        <p className="text-xs text-muted-foreground">
          Visible at{" "}
          <a href="/browse" className="underline underline-offset-2 hover:text-foreground">
            /browse
          </a>
        </p>
      )}
    </div>
  );
}
