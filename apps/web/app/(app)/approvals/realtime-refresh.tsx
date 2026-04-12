"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";

/**
 * Invisible client component that subscribes to Supabase Realtime for the
 * approvals table. When any approval is inserted or updated it calls
 * router.refresh() which re-runs the server component and repopulates the list
 * without a full page reload.
 */
export function ApprovalsRealtimeRefresh() {
  const router = useRouter();

  useEffect(() => {
    const supabase = createBrowserClient();

    const channel = supabase
      .channel("approvals-page")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "approvals" },
        () => { router.refresh(); }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [router]);

  return null;
}
