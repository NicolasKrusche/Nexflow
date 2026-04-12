"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createBrowserClient } from "@/lib/supabase/client";

export default function UpdatePasswordPage() {
  const router = useRouter();
  const supabase = createBrowserClient();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }

    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setError(error.message);
      setLoading(false);
    } else {
      router.push("/dashboard");
    }
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4"
      style={{ background: "radial-gradient(ellipse 80% 60% at 50% -10%, rgba(249,115,22,0.09) 0%, transparent 60%)" }}
    >
      <div className="w-full max-w-sm">
        <div className="rounded-2xl border border-border bg-card p-8 shadow-xl">

          {/* Logo + heading */}
          <div className="flex flex-col items-center gap-4 mb-8">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/pictures/logo-no-bg.png"
              alt="Nexflow"
              className="h-11 w-11 object-contain"
            />
            <div className="text-center">
              <h1 className="text-xl font-bold tracking-tight">Set new password</h1>
              <p className="text-muted-foreground mt-1 text-sm">Choose a strong password for your account.</p>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="password" className="block text-xs font-medium text-muted-foreground mb-1.5">
                New password
              </label>
              <input
                id="password"
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg border border-input bg-background/60 px-3 py-2.5 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring transition-shadow"
                placeholder="Min. 8 characters"
              />
            </div>
            <div>
              <label htmlFor="confirm" className="block text-xs font-medium text-muted-foreground mb-1.5">
                Confirm password
              </label>
              <input
                id="confirm"
                type="password"
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="w-full rounded-lg border border-input bg-background/60 px-3 py-2.5 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring transition-shadow"
                placeholder="••••••••"
              />
            </div>

            {error && (
              <p className="text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-primary text-primary-foreground px-4 py-2.5 text-sm font-semibold hover:opacity-90 disabled:opacity-50 transition-opacity shadow-[0_0_16px_rgba(249,115,22,0.3)]"
            >
              {loading ? "Updating…" : "Update password"}
            </button>
          </form>

          <p className="mt-6 text-center text-xs text-muted-foreground">
            <Link href="/login" className="hover:text-foreground transition-colors">
              ← Back to sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
