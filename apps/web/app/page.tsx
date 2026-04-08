import Link from "next/link";

// ─── Data ─────────────────────────────────────────────────────────────────────

const CONNECTORS = [
  "Gmail", "Slack", "Notion", "GitHub", "Google Sheets",
  "Airtable", "HubSpot", "Asana", "Outlook", "Typeform",
  "Google Docs", "Google Drive",
];

const FEATURES = [
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="w-5 h-5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09Z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 0 0-2.456 2.456Z" />
      </svg>
    ),
    title: "AI-Designed Graphs",
    body: "Type a sentence. Nexflow generates a complete, runnable agent graph — nodes, edges, prompts, and connections already wired up.",
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="w-5 h-5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
      </svg>
    ),
    title: "Visual Drag-and-Drop Editor",
    body: "Rearrange nodes, tune prompts, swap models, and rewire connections — all without touching a config file or writing workflow code.",
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="w-5 h-5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
      </svg>
    ),
    title: "Runs on Autopilot",
    body: "Schedule runs, react to webhooks, chain programs, and get live execution logs — without managing any infrastructure.",
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="w-5 h-5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 10.5V6.75a4.5 4.5 0 1 1 9 0v3.75M3.75 21.75h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H3.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
      </svg>
    ),
    title: "Secrets Stay Secret",
    body: "OAuth tokens and API keys are encrypted in Vault and never returned to the frontend. Every model call routes through a server-side proxy.",
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="w-5 h-5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21 3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
      </svg>
    ),
    title: "Human-in-the-Loop",
    body: "Pause execution at any node and wait for your approval before proceeding. Perfect for high-stakes actions like sending emails or writing to databases.",
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="w-5 h-5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18 9 11.25l4.306 4.306a11.95 11.95 0 0 1 5.814-5.518l2.74-1.22m0 0-5.94-2.281m5.94 2.28-2.28 5.941" />
      </svg>
    ),
    title: "Live Run Visualization",
    body: "Watch nodes light up in real time as your program executes. Active edges pulse, completed nodes turn green, errors surface inline.",
  },
];

const HOW_IT_WORKS = [
  {
    step: "01",
    title: "Describe",
    body: 'Type what you want to automate in plain English — "When I get a new GitHub issue, summarize it with AI and post it to Slack."',
  },
  {
    step: "02",
    title: "Design",
    body: "Nexflow generates a full agent graph. Drag nodes, swap models, tune prompts, and connect your accounts — visually, in seconds.",
  },
  {
    step: "03",
    title: "Deploy",
    body: "Hit Run. Triggers fire on schedule or on events, execution logs stream live, and you stay in control with one-click approvals.",
  },
];

// ─── Flow Diagram SVG ─────────────────────────────────────────────────────────

function FlowDiagram() {
  return (
    <svg
      viewBox="0 0 660 220"
      xmlns="http://www.w3.org/2000/svg"
      className="w-full select-none"
      aria-hidden
    >
      <defs>
        {/* Dot grid */}
        <pattern id="dots" x="0" y="0" width="22" height="22" patternUnits="userSpaceOnUse">
          <circle cx="1" cy="1" r="1" fill="#ffffff" fillOpacity="0.04" />
        </pattern>
        {/* Edge arrowhead */}
        <marker id="arrow-orange" markerWidth="7" markerHeight="7" refX="3.5" refY="3.5" orient="auto">
          <path d="M0,1 L0,6 L6,3.5 z" fill="#f97316" fillOpacity="0.55" />
        </marker>
        <marker id="arrow-purple" markerWidth="7" markerHeight="7" refX="3.5" refY="3.5" orient="auto">
          <path d="M0,1 L0,6 L6,3.5 z" fill="#a855f7" fillOpacity="0.55" />
        </marker>
        {/* Node glow filters */}
        <filter id="glow-orange" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        <filter id="glow-agent" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="5" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>

      {/* Background */}
      <rect width="660" height="220" rx="12" fill="#0c0a08" />
      <rect width="660" height="220" rx="12" fill="url(#dots)" />

      {/* Mini toolbar */}
      <rect width="660" height="32" rx="12" fill="#141210" />
      <rect y="12" width="660" height="20" fill="#141210" />
      <circle cx="18" cy="16" r="4" fill="#3f3a36" />
      <circle cx="32" cy="16" r="4" fill="#3f3a36" />
      <circle cx="46" cy="16" r="4" fill="#3f3a36" />
      <text x="330" y="21" fontSize="9" fill="#555" textAnchor="middle" fontFamily="system-ui">
        Programs / Email Summary / editor
      </text>

      {/* ── Edge: Trigger → Agent ── */}
      <line
        x1="205" y1="129"
        x2="248" y2="129"
        stroke="#f97316"
        strokeWidth="1.5"
        strokeOpacity="0.5"
        strokeDasharray="5,3"
        markerEnd="url(#arrow-orange)"
        className="edge-animate"
      />

      {/* ── Edge: Agent → Step ── */}
      <line
        x1="415" y1="129"
        x2="458" y2="129"
        stroke="#a855f7"
        strokeWidth="1.5"
        strokeOpacity="0.5"
        strokeDasharray="5,3"
        markerEnd="url(#arrow-purple)"
        className="edge-animate"
        style={{ animationDelay: "0.4s" }}
      />

      {/* ── Trigger Node ── */}
      <g filter="url(#glow-orange)">
        <rect x="28" y="90" width="177" height="78" rx="8" fill="#110e0a" stroke="#f97316" strokeWidth="1.25" strokeOpacity="0.7" />
        <rect x="28" y="98" width="177" height="14" fill="#f97316" fillOpacity="0.1" />
        {/* Handle dot */}
        <circle cx="205" cy="129" r="3.5" fill="#f97316" fillOpacity="0.8" />
        {/* Label */}
        <text x="40" y="109" fontSize="7.5" fill="#f97316" fontFamily="monospace" fontWeight="700" letterSpacing="1.5">TRIGGER</text>
        {/* Title */}
        <text x="40" y="132" fontSize="11.5" fill="#f0ede8" fontWeight="600" fontFamily="system-ui">New Email Received</text>
        {/* Subtitle */}
        <text x="40" y="150" fontSize="9" fill="#6b6560" fontFamily="system-ui">via Gmail · unread</text>
      </g>

      {/* ── Agent Node ── */}
      <g filter="url(#glow-agent)">
        <rect x="248" y="90" width="167" height="78" rx="8" fill="#110e14" stroke="#a855f7" strokeWidth="1.5" strokeOpacity="0.75" />
        <rect x="248" y="98" width="167" height="14" fill="#a855f7" fillOpacity="0.12" />
        {/* Handles */}
        <circle cx="248" cy="129" r="3.5" fill="#a855f7" fillOpacity="0.8" />
        <circle cx="415" cy="129" r="3.5" fill="#a855f7" fillOpacity="0.8" />
        {/* Label */}
        <text x="260" y="109" fontSize="7.5" fill="#a855f7" fontFamily="monospace" fontWeight="700" letterSpacing="1.5">AGENT</text>
        {/* Title */}
        <text x="260" y="132" fontSize="11.5" fill="#f0ede8" fontWeight="600" fontFamily="system-ui">AI Summarizer</text>
        {/* Subtitle */}
        <text x="260" y="150" fontSize="9" fill="#6b6560" fontFamily="system-ui">GPT-4o · 3 tools assigned</text>
      </g>

      {/* ── Step Node ── */}
      <g>
        <rect x="458" y="90" width="167" height="78" rx="8" fill="#0c110e" stroke="#10b981" strokeWidth="1.25" strokeOpacity="0.65" />
        <rect x="458" y="98" width="167" height="14" fill="#10b981" fillOpacity="0.1" />
        {/* Handle */}
        <circle cx="458" cy="129" r="3.5" fill="#10b981" fillOpacity="0.8" />
        {/* Label */}
        <text x="470" y="109" fontSize="7.5" fill="#10b981" fontFamily="monospace" fontWeight="700" letterSpacing="1.5">STEP</text>
        {/* Title */}
        <text x="470" y="132" fontSize="11.5" fill="#f0ede8" fontWeight="600" fontFamily="system-ui">Save to Notion</text>
        {/* Subtitle */}
        <text x="470" y="150" fontSize="9" fill="#6b6560" fontFamily="system-ui">append_to_page · inbox</text>
      </g>

      {/* Status badge — bottom right */}
      <rect x="558" y="192" width="84" height="18" rx="9" fill="#10b981" fillOpacity="0.12" />
      <circle cx="570" cy="201" r="3" fill="#10b981" fillOpacity="0.9" />
      <text x="577" y="205" fontSize="8.5" fill="#10b981" fontFamily="system-ui" fontWeight="500">Running…</text>
    </svg>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background text-foreground overflow-x-hidden">

      {/* ── Nav ── */}
      <header className="sticky top-0 z-50 border-b border-border/60 bg-background/80 backdrop-blur-md">
        <div className="mx-auto max-w-6xl flex items-center justify-between px-6 h-14">
          <div className="flex items-center gap-2.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/pictures/logo-no-bg.png"
              alt="Nexflow"
              className="h-7 w-7 object-contain"
            />
            <span className="font-bold text-base tracking-tight">Nexflow</span>
          </div>
          <nav className="hidden md:flex items-center gap-6 text-sm text-muted-foreground">
            <a href="#how-it-works" className="hover:text-foreground transition-colors">How it works</a>
            <a href="#features" className="hover:text-foreground transition-colors">Features</a>
            <a href="#integrations" className="hover:text-foreground transition-colors">Integrations</a>
          </nav>
          <div className="flex items-center gap-3">
            <Link
              href="/login"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Sign in
            </Link>
            <Link
              href="/signup"
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-1.75 text-sm font-semibold text-primary-foreground shadow-[0_0_16px_rgba(249,115,22,0.35)] hover:opacity-90 transition-opacity"
            >
              Get started free
              <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
                <path fillRule="evenodd" d="M6.22 3.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06-1.06L9.94 8 6.22 4.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
              </svg>
            </Link>
          </div>
        </div>
      </header>

      {/* ── Hero ── */}
      <section className="relative flex flex-col items-center text-center px-6 pt-20 pb-16 overflow-hidden">
        {/* Background glow */}
        <div className="pointer-events-none absolute inset-0 -top-20"
          style={{ background: "radial-gradient(ellipse 70% 40% at 50% 0%, rgba(249,115,22,0.12) 0%, transparent 70%)" }}
        />

        {/* Announcement badge */}
        <div className="animate-fade-up relative z-10 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/8 px-4 py-1.5 text-xs font-medium text-primary mb-7">
          <span className="relative flex h-1.5 w-1.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-60"></span>
            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-primary"></span>
          </span>
          10+ integrations — Gmail, Slack, Notion, GitHub &amp; more
        </div>

        {/* Headline */}
        <h1 className="animate-fade-up-delay-1 relative z-10 text-5xl sm:text-6xl lg:text-7xl font-extrabold tracking-tight leading-[1.08] max-w-4xl">
          Build AI automations,
          <br />
          <span className="bg-gradient-to-r from-orange-400 via-orange-500 to-red-500 bg-clip-text text-transparent">
            visually.
          </span>
        </h1>

        {/* Subheadline */}
        <p className="animate-fade-up-delay-2 relative z-10 mt-6 text-lg text-muted-foreground max-w-xl leading-relaxed">
          Describe what you want to automate. Nexflow designs the agent graph,
          you tune it visually — then it runs itself.
        </p>

        {/* CTAs */}
        <div className="animate-fade-up-delay-3 relative z-10 mt-8 flex flex-col sm:flex-row items-center gap-3">
          <Link
            href="/signup"
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground shadow-[0_0_24px_rgba(249,115,22,0.4)] hover:opacity-90 transition-opacity"
          >
            Start for free
            <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
              <path fillRule="evenodd" d="M6.22 3.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06-1.06L9.94 8 6.22 4.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
            </svg>
          </Link>
          <Link
            href="/login"
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-background/50 px-6 py-3 text-sm font-medium text-foreground hover:bg-accent transition-colors"
          >
            Sign in to dashboard
          </Link>
        </div>

        {/* Flow diagram */}
        <div className="animate-fade-up-delay-4 relative z-10 mt-14 w-full max-w-3xl rounded-xl border border-border/70 shadow-[0_0_60px_rgba(249,115,22,0.08)] overflow-hidden">
          <FlowDiagram />
        </div>
      </section>

      {/* ── Connector strip ── */}
      <section id="integrations" className="border-y border-border/60 bg-card/40 py-10 px-6">
        <div className="mx-auto max-w-4xl text-center">
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-6">
            Connects to your entire stack
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2.5">
            {CONNECTORS.map((name) => (
              <span
                key={name}
                className="rounded-full border border-border px-3.5 py-1.5 text-xs font-medium text-muted-foreground hover:border-primary/50 hover:text-foreground transition-colors cursor-default"
              >
                {name}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ── How it works ── */}
      <section id="how-it-works" className="py-24 px-6">
        <div className="mx-auto max-w-5xl">
          <div className="text-center mb-14">
            <p className="text-xs font-semibold uppercase tracking-widest text-primary mb-3">How it works</p>
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">Three steps to production</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {HOW_IT_WORKS.map((item) => (
              <div key={item.step} className="flex flex-col gap-4">
                <span className="text-4xl font-black text-primary/20 leading-none">{item.step}</span>
                <div>
                  <h3 className="text-lg font-semibold mb-2">{item.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{item.body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Features ── */}
      <section id="features" className="py-24 px-6 border-t border-border/60">
        <div className="mx-auto max-w-5xl">
          <div className="text-center mb-14">
            <p className="text-xs font-semibold uppercase tracking-widest text-primary mb-3">Features</p>
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
              Everything you need to automate at scale
            </h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {FEATURES.map((f) => (
              <div
                key={f.title}
                className="group rounded-xl border border-border bg-card p-6 flex flex-col gap-4 hover:border-primary/40 hover:bg-accent/30 transition-all duration-200"
              >
                <div className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-primary/10 text-primary group-hover:bg-primary/15 transition-colors">
                  {f.icon}
                </div>
                <div>
                  <h3 className="font-semibold text-sm mb-1.5">{f.title}</h3>
                  <p className="text-xs text-muted-foreground leading-relaxed">{f.body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="py-24 px-6 border-t border-border/60">
        <div className="mx-auto max-w-2xl text-center">
          <div
            className="relative rounded-2xl border border-primary/20 p-12 overflow-hidden"
            style={{ background: "radial-gradient(ellipse 80% 60% at 50% 100%, rgba(249,115,22,0.1) 0%, transparent 70%)" }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/pictures/logo-no-bg.png"
              alt=""
              aria-hidden
              className="mx-auto h-14 w-14 object-contain mb-6 opacity-90"
            />
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-4">
              Start automating today
            </h2>
            <p className="text-muted-foreground mb-8 leading-relaxed">
              Free to start. No credit card required. Your first two programs are on us.
            </p>
            <Link
              href="/signup"
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-8 py-3.5 text-sm font-semibold text-primary-foreground shadow-[0_0_32px_rgba(249,115,22,0.45)] hover:opacity-90 transition-opacity"
            >
              Create free account
              <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
                <path fillRule="evenodd" d="M6.22 3.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06-1.06L9.94 8 6.22 4.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
              </svg>
            </Link>
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="border-t border-border/60 px-6 py-6">
        <div className="mx-auto max-w-6xl flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/pictures/logo-no-bg.png" alt="" aria-hidden className="h-5 w-5 object-contain opacity-60" />
            <span>© {new Date().getFullYear()} Nexflow. All rights reserved.</span>
          </div>
          <div className="flex items-center gap-4">
            <Link href="/login" className="hover:text-foreground transition-colors">Sign in</Link>
            <Link href="/signup" className="hover:text-foreground transition-colors">Sign up</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
