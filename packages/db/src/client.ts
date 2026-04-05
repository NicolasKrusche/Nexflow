import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types.js";

// Server-side client (uses service role key — never expose to client)
export function createServerClient(supabaseUrl: string, serviceRoleKey: string) {
  return createClient<Database>(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

// Browser-side client (uses anon key + RLS)
export function createBrowserClient(supabaseUrl: string, anonKey: string) {
  return createClient<Database>(supabaseUrl, anonKey);
}

export type { Database };
