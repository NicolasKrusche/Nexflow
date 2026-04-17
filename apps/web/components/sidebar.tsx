"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { createBrowserClient } from "@/lib/supabase/client";
import { ThemePicker } from "@/components/theme-picker";

// ─── Nav item ─────────────────────────────────────────────────────────────────

function NavItem({
  href,
  label,
  icon,
  active,
  badge,
}: {
  href: string;
  label: string;
  icon: React.ReactNode;
  active: boolean;
  badge?: number;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "relative flex items-center gap-2.5 rounded-md px-3 py-[7px] text-sm transition-colors",
        active
          ? "bg-accent text-foreground font-medium"
          : "text-muted-foreground hover:bg-accent/60 hover:text-foreground font-normal"
      )}
    >
      {active && (
        <span className="absolute left-0 inset-y-2 w-[2px] rounded-full bg-primary" />
      )}
      <span className="shrink-0 w-4 h-4 flex items-center justify-center">{icon}</span>
      <span className="flex-1 truncate">{label}</span>
      {badge != null && badge > 0 && (
        <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold px-1 shrink-0">
          {badge > 99 ? "99+" : badge}
        </span>
      )}
    </Link>
  );
}

// ─── Main sidebar ─────────────────────────────────────────────────────────────

export function Sidebar() {
  const pathname = usePathname();
  const [pendingApprovals, setPendingApprovals] = useState(0);
  const [failedRuns, setFailedRuns] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function fetchCount() {
      try {
        const res = await fetch("/api/approvals");
        if (!res.ok) return;
        const data = (await res.json()) as { approvals: unknown[] };
        if (!cancelled) setPendingApprovals(data.approvals?.length ?? 0);
      } catch { /* badge won't show */ }
    }

    void fetchCount();

    const supabase = createBrowserClient();
    const channel = supabase
      .channel("sidebar-approvals")
      .on("postgres_changes", { event: "*", schema: "public", table: "approvals" }, () => { void fetchCount(); })
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (pathname.startsWith("/runs")) {
      localStorage.setItem("runs_last_seen", Date.now().toString());
      setFailedRuns(0);
      return;
    }
    async function fetchFailed() {
      try {
        const lastSeen = localStorage.getItem("runs_last_seen");
        const url = lastSeen ? `/api/runs/failed-count?since=${lastSeen}` : "/api/runs/failed-count";
        const res = await fetch(url);
        if (!res.ok) return;
        const data = (await res.json()) as { count: number };
        if (!cancelled) setFailedRuns(data.count ?? 0);
      } catch { /* badge won't show */ }
    }
    void fetchFailed();
    return () => { cancelled = true; };
  }, [pathname]);

  return (
    <aside className="fixed left-0 top-0 h-full w-56 bg-background border-r border-border flex flex-col z-40">
      {/* Logo */}
      <div className="h-14 flex items-center px-4 border-b border-border gap-2.5 shrink-0">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/pictures/logo-no-bg.png" alt="Nexflow" className="h-6 w-6 object-contain shrink-0" />
        <span className="font-bold text-sm tracking-tight">Nexflow</span>
      </div>

      <nav className="flex-1 px-2 py-3 overflow-y-auto space-y-0.5">
        {/* Dashboard */}
        <NavItem href="/dashboard" label="Dashboard" active={pathname === "/dashboard"}
          icon={<GridIcon />} />

        {/* Group separator */}
        <div className="!my-2 mx-3 h-px bg-border/60" />

        <NavItem href="/programs/new" label="New Program" active={pathname === "/programs/new"}
          icon={<PlusIcon />} />
        <NavItem href="/programs/import" label="Import" active={pathname.startsWith("/programs/import")}
          icon={<ImportIcon />} />
        <NavItem href="/browse" label="Browse" active={pathname.startsWith("/browse")}
          icon={<BrowseIcon />} />
        <NavItem href="/connections" label="Connections" active={pathname.startsWith("/connections")}
          icon={<LinkIcon />} />

        {/* Group separator */}
        <div className="!my-2 mx-3 h-px bg-border/60" />

        <NavItem href="/runs" label="Runs" active={pathname.startsWith("/runs")}
          icon={<RunsIcon />} badge={failedRuns} />
        <NavItem href="/approvals" label="Approvals" active={pathname.startsWith("/approvals")}
          icon={<BellIcon />} badge={pendingApprovals} />

        {/* Group separator */}
        <div className="!my-2 mx-3 h-px bg-border/60" />

        <NavItem href="/api-keys" label="API Keys" active={pathname.startsWith("/api-keys")}
          icon={<KeyIcon />} />
      </nav>

      <div className="border-t border-border shrink-0">
        <ThemePicker />
        <div className="p-2">
          <SignOutButton />
        </div>
      </div>
    </aside>
  );
}

function SignOutButton() {
  async function handleSignOut() {
    const { createBrowserClient } = await import("@/lib/supabase/client");
    const supabase = createBrowserClient();
    await supabase.auth.signOut();
    window.location.href = "/login";
  }
  return (
    <button
      onClick={handleSignOut}
      className="flex items-center gap-2.5 w-full rounded-md px-3 py-[7px] text-sm text-muted-foreground hover:bg-accent/60 hover:text-foreground transition-colors"
    >
      <span className="shrink-0 w-4 h-4 flex items-center justify-center"><LogOutIcon /></span>
      Sign out
    </button>
  );
}

// ─── Icons ─────────────────────────────────────────────────────────────────────

function GridIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
      <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  );
}
function PlusIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14M5 12h14" />
    </svg>
  );
}
function LinkIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
    </svg>
  );
}
function ImportIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v10m0 0l4-4m-4 4l-4-4M4 18.5h16" />
    </svg>
  );
}
function BellIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
    </svg>
  );
}
function KeyIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" />
    </svg>
  );
}
function RunsIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 010 1.972l-11.54 6.347a1.125 1.125 0 01-1.667-.986V5.653z" />
    </svg>
  );
}
function BrowseIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.5 8.5 10 10l-1.5 5.5 5.5-1.5 1.5-5.5z" />
    </svg>
  );
}
function LogOutIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75" />
    </svg>
  );
}
