"use client";

import { useState } from "react";
import Link from "next/link";
import { createBrowserClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const supabase = createBrowserClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleEmailLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setError(error.message);
      setLoading(false);
    } else {
      window.location.href = "/dashboard";
    }
  }

  async function handleGoogleLogin() {
    setLoading(true);
    setError(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) {
      setError(error.message);
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 relative overflow-hidden">
      {/* Background layers */}
      <div className="absolute inset-0 bg-grid-dots opacity-20" />
      {/* Orange ambient orb — top center */}
      <div
        className="pointer-events-none absolute -top-32 left-1/2 -translate-x-1/2 w-[700px] h-[420px] rounded-full"
        style={{ background: "radial-gradient(ellipse, rgba(249,115,22,0.12) 0%, transparent 70%)", filter: "blur(60px)" }}
      />
      {/* Purple accent orb — bottom right */}
      <div
        className="pointer-events-none absolute bottom-0 right-0 w-[500px] h-[400px] rounded-full"
        style={{ background: "radial-gradient(ellipse, rgba(168,85,247,0.07) 0%, transparent 70%)", filter: "blur(80px)" }}
      />

      <div className="relative w-full max-w-sm">
        {/* Card */}
        <div className="relative rounded-2xl border border-white/8 bg-card/80 backdrop-blur-sm p-8 shadow-[0_0_0_1px_rgba(255,255,255,0.03),0_32px_64px_rgba(0,0,0,0.5)]">
          {/* Top border glow */}
          <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-primary/30 to-transparent rounded-t-2xl" />

          {/* Logo + heading */}
          <div className="flex flex-col items-center gap-4 mb-8">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/pictures/logo-no-bg.png"
              alt="Nexflow"
              className="h-11 w-11 object-contain"
            />
            <div className="text-center">
              <h1 className="text-xl font-bold tracking-tight">Welcome back</h1>
              <p className="text-muted-foreground mt-1 text-sm">Sign in to your Nexflow account</p>
            </div>
          </div>

          {/* Google OAuth */}
          <button
            onClick={handleGoogleLogin}
            disabled={loading}
            className="w-full flex items-center justify-center gap-2.5 rounded-lg border border-border bg-background/50 px-4 py-2.5 text-sm font-medium hover:bg-accent hover:border-border/80 transition-all duration-150 disabled:opacity-50 mb-5"
          >
            <svg viewBox="0 0 24 24" className="w-4 h-4 shrink-0" aria-hidden>
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
            </svg>
            Continue with Google
          </button>

          {/* Divider */}
          <div className="relative flex items-center mb-5">
            <div className="flex-1 border-t border-border/60" />
            <span className="mx-3 text-xs text-muted-foreground/50">or</span>
            <div className="flex-1 border-t border-border/60" />
          </div>

          {/* Email form */}
          <form onSubmit={handleEmailLogin} className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-xs font-medium text-muted-foreground mb-1.5">
                Email address
              </label>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-lg border border-input bg-background/60 px-3 py-2.5 text-sm placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary/50 focus:border-primary/40 transition-all"
                placeholder="you@example.com"
              />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label htmlFor="password" className="block text-xs font-medium text-muted-foreground">
                  Password
                </label>
                <Link href="/forgot-password" className="text-xs text-muted-foreground/60 hover:text-foreground transition-colors">
                  Forgot password?
                </Link>
              </div>
              <input
                id="password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg border border-input bg-background/60 px-3 py-2.5 text-sm placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary/50 focus:border-primary/40 transition-all"
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
              className="w-full rounded-lg bg-primary text-primary-foreground px-4 py-2.5 text-sm font-semibold hover:opacity-90 disabled:opacity-50 transition-opacity shadow-[0_0_20px_rgba(249,115,22,0.35)]"
            >
              {loading ? "Signing in…" : "Sign in"}
            </button>
          </form>

          {/* Footer link */}
          <p className="mt-6 text-center text-xs text-muted-foreground/60">
            No account?{" "}
            <Link href="/signup" className="text-foreground font-medium hover:text-primary transition-colors">
              Sign up for free
            </Link>
          </p>
        </div>

        {/* Back link */}
        <p className="text-center mt-4 text-xs text-muted-foreground/50">
          <Link href="/" className="hover:text-foreground transition-colors">
            ← Back to homepage
          </Link>
        </p>
      </div>
    </div>
  );
}
