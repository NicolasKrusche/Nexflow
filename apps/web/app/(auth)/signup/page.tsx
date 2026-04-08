"use client";

import { useState } from "react";
import Link from "next/link";
import { createBrowserClient } from "@/lib/supabase/client";

export default function SignupPage() {
  const supabase = createBrowserClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) {
      setError(error.message);
      setLoading(false);
    } else {
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (!signInError) {
        window.location.href = "/dashboard";
      } else {
        setDone(true);
      }
    }
  }

  if (done) {
    return (
      <div
        className="min-h-screen flex items-center justify-center px-4"
        style={{ background: "radial-gradient(ellipse 80% 60% at 50% -10%, rgba(249,115,22,0.09) 0%, transparent 60%)" }}
      >
        <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-8 shadow-xl text-center space-y-3">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-primary/10 text-primary mx-auto mb-2">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-6 h-6">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75" />
            </svg>
          </div>
          <h2 className="text-xl font-bold tracking-tight">Check your inbox</h2>
          <p className="text-muted-foreground text-sm leading-relaxed">
            We sent a confirmation link to{" "}
            <span className="text-foreground font-medium">{email}</span>.
            <br />Click it to activate your account.
          </p>
          <Link
            href="/login"
            className="inline-block mt-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            ← Back to sign in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4"
      style={{ background: "radial-gradient(ellipse 80% 60% at 50% -10%, rgba(249,115,22,0.09) 0%, transparent 60%)" }}
    >
      <div className="w-full max-w-sm">

        {/* Card */}
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
              <h1 className="text-xl font-bold tracking-tight">Create your account</h1>
              <p className="text-muted-foreground mt-1 text-sm">
                Free to start — no credit card required
              </p>
            </div>
          </div>

          {/* Email form */}
          <form onSubmit={handleSignup} className="space-y-4">
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
                className="w-full rounded-lg border border-input bg-background/60 px-3 py-2.5 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring transition-shadow"
                placeholder="you@example.com"
              />
            </div>
            <div>
              <label htmlFor="password" className="block text-xs font-medium text-muted-foreground mb-1.5">
                Password
                <span className="ml-1 font-normal opacity-60">(min. 8 characters)</span>
              </label>
              <input
                id="password"
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
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
              {loading ? "Creating account…" : "Create free account"}
            </button>
          </form>

          {/* Terms note */}
          <p className="mt-4 text-center text-[11px] text-muted-foreground/70 leading-relaxed">
            By signing up you agree to our terms of service
            <br />and privacy policy.
          </p>

          {/* Footer link */}
          <p className="mt-5 text-center text-xs text-muted-foreground border-t border-border pt-5">
            Already have an account?{" "}
            <Link href="/login" className="text-foreground font-medium hover:text-primary transition-colors">
              Sign in
            </Link>
          </p>
        </div>

        {/* Back link */}
        <p className="text-center mt-4 text-xs text-muted-foreground">
          <Link href="/" className="hover:text-foreground transition-colors">
            ← Back to homepage
          </Link>
        </p>
      </div>
    </div>
  );
}
