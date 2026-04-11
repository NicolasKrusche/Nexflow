"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// ─── Types ────────────────────────────────────────────────────────────────────

type NodeSummary = {
  total: number;
  connections_needed: string[];
  has_ai: boolean;
};

type PublicProgram = {
  id: string;
  name: string;
  description: string | null;
  tags: string[];
  fork_count: number;
  published_at: string | null;
  public_author_name: string | null;
  schema_version: number;
  node_summary: NodeSummary;
};

// ─── Browse page ──────────────────────────────────────────────────────────────

export function BrowseClient({
  initialPrograms,
  initialTotal,
}: {
  initialPrograms: PublicProgram[];
  initialTotal: number;
}) {
  const [programs, setPrograms] = useState<PublicProgram[]>(initialPrograms);
  const [total, setTotal] = useState(initialTotal);
  const [loading, setLoading] = useState(false);
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [forking, setForking] = useState<string | null>(null);
  const [forked, setForked] = useState<Record<string, string>>({}); // id → new program id

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Only re-fetch when filters are actually set — initial data comes from server
  useEffect(() => {
    if (!q && !activeTag) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);

    let cancelled = false;

    const doFetch = (searchQ: string) => {
      setLoading(true);
      const params = new URLSearchParams();
      if (activeTag) params.set("tag", activeTag);
      if (searchQ) params.set("q", searchQ);

      fetch(`/api/browse?${params.toString()}`)
        .then((res) => {
          if (!res.ok) throw new Error("Failed to load");
          return res.json() as Promise<{ programs: PublicProgram[]; total: number }>;
        })
        .then((data) => {
          if (!cancelled) { setPrograms(data.programs); setTotal(data.total); }
        })
        .catch(() => { if (!cancelled) setPrograms([]); })
        .finally(() => { if (!cancelled) setLoading(false); });
    };

    if (q) {
      debounceRef.current = setTimeout(() => doFetch(q), 350);
    } else {
      doFetch("");
    }

    return () => {
      cancelled = true;
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [q, activeTag]);

  // Collect all unique tags across loaded programs for the filter bar
  const allTags = [...new Set(programs.flatMap((p) => p.tags))].sort();

  async function handleFork(programId: string) {
    setForking(programId);
    try {
      const res = await fetch(`/api/browse/${programId}/fork`, { method: "POST" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        alert(body.error ?? "Failed to fork program");
        return;
      }
      const data = (await res.json()) as { program: { id: string } };
      setForked((prev) => ({ ...prev, [programId]: data.program.id }));
    } catch {
      alert("Failed to fork program");
    } finally {
      setForking(null);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold">Browse</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {total > 0 ? `${total} published program${total !== 1 ? "s" : ""}` : "Community-published automation programs"}
          {" — fork one to start from a working blueprint."}
        </p>
      </div>

      {/* Search + filter */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Input
          placeholder="Search programs..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="sm:max-w-xs"
        />
        {allTags.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              onClick={() => setActiveTag(null)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors border ${
                activeTag === null
                  ? "bg-foreground text-background border-foreground"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              All
            </button>
            {allTags.map((tag) => (
              <button
                key={tag}
                onClick={() => setActiveTag(activeTag === tag ? null : tag)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors border ${
                  activeTag === tag
                    ? "bg-foreground text-background border-foreground"
                    : "border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                {tag}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Grid */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="rounded-lg border border-border bg-card p-5 animate-pulse space-y-3">
              <div className="h-4 bg-muted rounded w-2/3" />
              <div className="h-3 bg-muted rounded w-full" />
              <div className="h-3 bg-muted rounded w-4/5" />
            </div>
          ))}
        </div>
      ) : programs.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <p className="text-muted-foreground text-sm">
            {q || activeTag ? "No programs match your search." : "No programs have been published yet."}
          </p>
          {(q || activeTag) && (
            <Button
              variant="ghost"
              size="sm"
              className="mt-2"
              onClick={() => { setQ(""); setActiveTag(null); }}
            >
              Clear filters
            </Button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {programs.map((program) => (
            <ProgramCard
              key={program.id}
              program={program}
              onFork={handleFork}
              forking={forking === program.id}
              forkedId={forked[program.id]}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Program card ─────────────────────────────────────────────────────────────

function ProgramCard({
  program,
  onFork,
  forking,
  forkedId,
}: {
  program: PublicProgram;
  onFork: (id: string) => void;
  forking: boolean;
  forkedId?: string;
}) {
  const summary = program.node_summary;

  return (
    <div className="rounded-lg border border-border bg-card flex flex-col p-5 gap-3 hover:border-foreground/20 transition-colors">
      {/* Name + tags */}
      <div className="space-y-1.5">
        <h2 className="text-sm font-semibold leading-snug line-clamp-2">{program.name}</h2>
        {program.description && (
          <p className="text-xs text-muted-foreground line-clamp-2">{program.description}</p>
        )}
      </div>

      {/* Tags */}
      {program.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {program.tags.map((tag) => (
            <Badge key={tag} variant="secondary" className="text-[10px] px-1.5 py-0">
              {tag}
            </Badge>
          ))}
        </div>
      )}

      {/* Node summary */}
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span>{summary.total} node{summary.total !== 1 ? "s" : ""}</span>
        {summary.has_ai && (
          <span className="inline-flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-violet-500" />
            AI
          </span>
        )}
        {summary.connections_needed.length > 0 && (
          <span className="truncate">
            needs: {summary.connections_needed.slice(0, 2).join(", ")}
            {summary.connections_needed.length > 2 && ` +${summary.connections_needed.length - 2}`}
          </span>
        )}
      </div>

      {/* Footer */}
      <div className="mt-auto pt-2 flex items-center justify-between gap-2 border-t border-border">
        <div className="text-[10px] text-muted-foreground space-y-0.5">
          {program.public_author_name && (
            <p>by {program.public_author_name}</p>
          )}
          <p className="flex items-center gap-1">
            <ForkIcon className="w-3 h-3" />
            {program.fork_count} fork{program.fork_count !== 1 ? "s" : ""}
          </p>
        </div>

        {forkedId ? (
          <Button asChild size="sm" variant="outline" className="text-xs h-7">
            <Link href={`/programs/${forkedId}`}>Open fork →</Link>
          </Button>
        ) : (
          <Button
            size="sm"
            variant="outline"
            className="text-xs h-7"
            onClick={() => onFork(program.id)}
            disabled={forking}
          >
            {forking ? "Forking…" : "Fork"}
          </Button>
        )}
      </div>
    </div>
  );
}

// ─── Icons ────────────────────────────────────────────────────────────────────

function ForkIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="currentColor">
      <path d="M5 3.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0zm0 2.122a2.25 2.25 0 1 0-1.5 0v.878A2.25 2.25 0 0 0 5.75 8.5h1.5v2.128a2.251 2.251 0 1 0 1.5 0V8.5h1.5a2.25 2.25 0 0 0 2.25-2.25v-.878a2.25 2.25 0 1 0-1.5 0v.878a.75.75 0 0 1-.75.75h-4.5A.75.75 0 0 1 5 6.25v-.878zm3.75 7.378a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0zm3-8.75a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0z" />
    </svg>
  );
}
