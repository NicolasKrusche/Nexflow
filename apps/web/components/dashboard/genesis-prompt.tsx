"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const EXAMPLES = [
  "When I get a new GitHub issue, summarize it with AI and post to Slack",
  "Every morning, pull my unread Gmail and save summaries to Notion",
  "When a Typeform submission comes in, create a HubSpot contact",
  "Summarize my weekly Google Sheets data and email me a report",
];

export function GenesisPrompt() {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [focused, setFocused] = useState(false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const prompt = value.trim();
    if (prompt) {
      router.push(`/programs/new?prompt=${encodeURIComponent(prompt)}`);
    } else {
      router.push("/programs/new");
    }
  }

  return (
    <div className="relative rounded-2xl border border-border overflow-hidden">
      {/* Backgrounds */}
      <div className="absolute inset-0 bg-grid-dots opacity-[0.18]" />
      <div
        className="absolute inset-0 transition-opacity duration-500"
        style={{
          background: "radial-gradient(ellipse 70% 90% at 50% 130%, rgba(249,115,22,0.1) 0%, transparent 70%)",
          opacity: focused ? 1 : 0.5,
        }}
      />
      <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-primary/20 to-transparent" />

      <div className="relative px-8 py-7">
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground/40 mb-2 font-mono">
          New automation
        </p>
        <h2 className="text-lg font-bold mb-5">What do you want to automate?</h2>

        <form onSubmit={handleSubmit} className="flex gap-3">
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder={EXAMPLES[Math.floor(Date.now() / 8000) % EXAMPLES.length] + "…"}
            className="flex-1 rounded-xl border border-border bg-background/70 px-4 py-3 text-sm placeholder:text-muted-foreground/30 focus:outline-none focus:ring-1 focus:ring-primary/40 focus:border-primary/40 transition-all duration-200"
          />
          <button
            type="submit"
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-bold text-primary-foreground shadow-[0_0_20px_rgba(249,115,22,0.3)] hover:shadow-[0_0_30px_rgba(249,115,22,0.45)] hover:opacity-95 transition-all duration-200 shrink-0 whitespace-nowrap"
          >
            Generate
            <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
              <path fillRule="evenodd" d="M6.22 3.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06-1.06L9.94 8 6.22 4.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
            </svg>
          </button>
        </form>

        <p className="text-[11px] text-muted-foreground/35 mt-3">
          Describe in plain English · AI designs the graph · You tune it visually
        </p>
      </div>
    </div>
  );
}
