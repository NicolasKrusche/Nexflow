import Link from "next/link";

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      {/* Nav */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-border">
        <div className="flex items-center gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/pictures/logo-no-bg.png"
            alt="Nexflow"
            className="h-8 w-8 object-contain"
          />
          <span className="font-semibold text-lg tracking-tight">Nexflow</span>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/login"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Sign in
          </Link>
          <Link
            href="/signup"
            className="rounded-md bg-primary text-primary-foreground px-4 py-1.5 text-sm font-medium hover:opacity-90 transition-opacity"
          >
            Get started
          </Link>
        </div>
      </header>

      {/* Hero */}
      <main className="flex-1 flex flex-col items-center justify-center px-6 text-center gap-8 py-24">
        {/* Logo mark */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/pictures/logo-no-bg.png"
          alt=""
          aria-hidden
          className="h-20 w-20 object-contain"
        />

        <div className="max-w-2xl space-y-4">
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight leading-tight">
            Automate anything,<br />visually.
          </h1>
          <p className="text-lg text-muted-foreground max-w-xl mx-auto">
            Describe what you want to automate. Nexflow designs the agent graph,
            you tune it visually — then it runs itself.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row items-center gap-3">
          <Link
            href="/signup"
            className="rounded-md bg-primary text-primary-foreground px-6 py-2.5 text-sm font-semibold hover:opacity-90 transition-opacity"
          >
            Start for free
          </Link>
          <Link
            href="/login"
            className="rounded-md border border-border bg-background text-foreground px-6 py-2.5 text-sm font-medium hover:bg-accent transition-colors"
          >
            Sign in
          </Link>
        </div>

        {/* Feature grid */}
        <div className="mt-8 grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-2xl w-full text-left">
          {[
            {
              title: "Describe → Design",
              body: "Type what you want to automate. AI generates a graph of agents and steps instantly.",
            },
            {
              title: "Visual editor",
              body: "Drag nodes, tune prompts, wire connections — all without writing workflow code.",
            },
            {
              title: "Runs itself",
              body: "Triggers, schedules, webhooks and inter-program chains keep your automations running.",
            },
          ].map((f) => (
            <div
              key={f.title}
              className="rounded-lg border border-border bg-card px-5 py-4 space-y-1.5"
            >
              <p className="text-sm font-semibold">{f.title}</p>
              <p className="text-xs text-muted-foreground leading-relaxed">{f.body}</p>
            </div>
          ))}
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-border px-6 py-4 flex items-center justify-between text-xs text-muted-foreground">
        <span>© {new Date().getFullYear()} Nexflow</span>
        <Link href="/login" className="hover:text-foreground transition-colors">
          Sign in
        </Link>
      </footer>
    </div>
  );
}
