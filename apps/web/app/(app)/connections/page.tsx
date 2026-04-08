"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type Connection = {
  id: string;
  name: string;
  provider: string;
  auth_type: "oauth" | "api_key";
  scopes: string[] | null;
  metadata: { email?: string } | null;
  is_valid: boolean;
  last_validated_at: string | null;
  created_at: string;
};

const PROVIDER_LABELS: Record<string, string> = {
  gmail: "Gmail",
  sheets: "Google Sheets",
  slack: "Slack",
  notion: "Notion",
  calendar: "Google Calendar",
  airtable: "Airtable",
  hubspot: "HubSpot",
  docs: "Google Docs",
  github: "GitHub",
  typeform: "Typeform",
  asana: "Asana",
  drive: "Google Drive",
  outlook: "Outlook Mail",
};

// Wikimedia Commons SVGs via Special:FilePath (302 → upload.wikimedia.org, no hash needed)
// Falls back to Google favicon API for brands without a clean Wikimedia file
const PROVIDER_ICON_URL: Record<string, string> = {
  gmail:    "https://commons.wikimedia.org/wiki/Special:FilePath/Gmail_icon_(2020).svg",
  sheets:   "https://upload.wikimedia.org/wikipedia/commons/a/ae/Google_Sheets_2020_Logo.svg",
  calendar: "https://commons.wikimedia.org/wiki/Special:FilePath/Google_Calendar_icon_(2020).svg",
  docs:     "https://upload.wikimedia.org/wikipedia/commons/6/66/Google_Docs_2020_Logo.svg",
  drive:    "https://upload.wikimedia.org/wikipedia/commons/1/12/Google_Drive_icon_%282020%29.svg",
  slack:    "https://commons.wikimedia.org/wiki/Special:FilePath/Slack_icon_2019.svg",
  github:   "https://commons.wikimedia.org/wiki/Special:FilePath/GitHub_Invertocat_Logo.svg",
  outlook:  "https://upload.wikimedia.org/wikipedia/commons/4/45/Microsoft_Office_Outlook_%282018%E2%80%932024%29.svg",
  // Favicon API for brands without reliable Wikimedia SVGs
  notion:   "https://www.google.com/s2/favicons?domain=notion.so&sz=64",
  airtable: "https://www.google.com/s2/favicons?domain=airtable.com&sz=64",
  hubspot:  "https://upload.wikimedia.org/wikipedia/commons/3/3f/HubSpot_Logo.svg",
  typeform: "https://www.google.com/s2/favicons?domain=typeform.com&sz=64",
  asana:    "https://www.google.com/s2/favicons?domain=app.asana.com&sz=64",
};

function ProviderLogo({ provider, size = 28 }: { provider: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  const iconUrl = PROVIDER_ICON_URL[provider] ?? null;

  if (!iconUrl || failed) {
    return (
      <div
        style={{ width: size, height: size }}
        className="rounded-md bg-muted flex items-center justify-center text-[10px] font-bold text-muted-foreground shrink-0"
      >
        {provider.slice(0, 2).toUpperCase()}
      </div>
    );
  }
  return (
    <div
      style={{ width: size, height: size }}
      className="rounded-md bg-white border border-border flex items-center justify-center shrink-0 overflow-hidden p-0.5"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={iconUrl}
        alt={PROVIDER_LABELS[provider] ?? provider}
        width={size - 4}
        height={size - 4}
        style={{ objectFit: "contain" }}
        onError={() => setFailed(true)}
      />
    </div>
  );
}

type Provider = {
  id: string;
  label: string;
  description: string;
  wave: 1 | 2 | 3;
  href: string;
};

const AVAILABLE_PROVIDERS: Provider[] = [
  // Wave 1
  { id: "gmail",    label: "Gmail",           description: "Send and read emails",                  wave: 1, href: "/api/connections/oauth/gmail?label=gmail:primary" },
  { id: "sheets",   label: "Google Sheets",   description: "Read and write spreadsheet data",       wave: 1, href: "/api/connections/oauth/google?service=sheets&label=sheets:primary" },
  { id: "slack",    label: "Slack",           description: "Post messages and read channels",       wave: 1, href: "/api/connections/oauth/slack?label=slack:primary" },
  { id: "notion",   label: "Notion",          description: "Read and write pages and databases",    wave: 1, href: "/api/connections/oauth/notion?label=notion:primary" },
  { id: "calendar", label: "Google Calendar", description: "Read and create calendar events",       wave: 1, href: "/api/connections/oauth/google?service=calendar&label=calendar:primary" },
  { id: "airtable", label: "Airtable",        description: "Read and write Airtable bases",         wave: 1, href: "/api/connections/oauth/airtable?label=airtable:primary" },
  { id: "hubspot",  label: "HubSpot",         description: "Manage contacts, deals, and content",   wave: 1, href: "/api/connections/oauth/hubspot?label=hubspot:primary" },
  { id: "docs",     label: "Google Docs",     description: "Read and write documents",              wave: 1, href: "/api/connections/oauth/google?service=docs&label=docs:primary" },
  // Wave 2
  { id: "github",   label: "GitHub",          description: "Create issues, PRs, and read repos",   wave: 2, href: "/api/connections/oauth/github?label=github:primary" },
  { id: "typeform", label: "Typeform",        description: "Read form responses and definitions",   wave: 2, href: "/api/connections/oauth/typeform?label=typeform:primary" },
  { id: "asana",    label: "Asana",           description: "Manage tasks and projects",             wave: 2, href: "/api/connections/oauth/asana?label=asana:primary" },
  { id: "drive",    label: "Google Drive",    description: "Read and manage Drive files",           wave: 2, href: "/api/connections/oauth/google?service=drive&label=drive:primary" },
  { id: "outlook",  label: "Outlook Mail",    description: "Send and read Outlook email",           wave: 2, href: "/api/connections/oauth/outlook?label=outlook:primary" },
];

export default function ConnectionsPage() {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [connecting, setConnecting] = useState<string | null>(null);
  const searchParams = useSearchParams();

  const successProvider = searchParams.get("connected");
  const errorCode = searchParams.get("error");

  async function load() {
    setLoading(true);
    const res = await fetch("/api/connections");
    if (res.ok) setConnections(await res.json());
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function handleTest(id: string) {
    setTesting(id);
    await fetch(`/api/connections/${id}`, { method: "POST" });
    load();
    setTesting(null);
  }

  async function handleDelete(id: string) {
    setDeleting(id);
    await fetch(`/api/connections/${id}`, { method: "DELETE" });
    setConnections((prev) => prev.filter((c) => c.id !== id));
    setDeleting(null);
  }

  function handleConnect(provider: Provider) {
    setConnecting(provider.id);
    window.location.href = provider.href;
  }

  const connectedProviders = new Set(connections.map((c) => c.provider));

  return (
    <div className="max-w-2xl space-y-8">
      <div>
        <h1 className="text-xl font-semibold">Connections</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Connect your apps. OAuth tokens are encrypted and stored securely.
        </p>
      </div>

      {successProvider && (
        <div className="rounded-md bg-green-500/10 border border-green-500/20 text-green-700 dark:text-green-400 px-4 py-3 text-sm">
          Successfully connected {PROVIDER_LABELS[successProvider] ?? successProvider}.
        </div>
      )}
      {errorCode && (
        <div className="rounded-md bg-destructive/10 border border-destructive/20 text-destructive px-4 py-3 text-sm">
          OAuth failed: {errorCode}. Please try again.
        </div>
      )}

      {/* Existing connections */}
      {!loading && connections.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Connected</h2>
          {connections.map((conn) => (
            <Card key={conn.id}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-3">
                    <ProviderLogo provider={conn.provider} />
                    <div>
                      <CardTitle className="text-sm">{conn.name}</CardTitle>
                      <CardDescription className="text-xs mt-0.5">
                        {PROVIDER_LABELS[conn.provider] ?? conn.provider}
                        {conn.metadata?.email && <> · {conn.metadata.email}</>}
                        {conn.last_validated_at && (
                          <> · Tested {new Date(conn.last_validated_at).toLocaleDateString()}</>
                        )}
                      </CardDescription>
                    </div>
                  </div>
                  <Badge variant={conn.is_valid ? "success" : "destructive"}>
                    {conn.is_valid ? "Connected" : "Disconnected"}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="pt-0 flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={testing === conn.id}
                  onClick={() => handleTest(conn.id)}
                >
                  {testing === conn.id ? "Testing…" : "Test"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-destructive hover:text-destructive"
                  disabled={deleting === conn.id}
                  onClick={() => handleDelete(conn.id)}
                >
                  {deleting === conn.id ? "Removing…" : "Disconnect"}
                </Button>
              </CardContent>
            </Card>
          ))}
        </section>
      )}

      {/* Available to connect */}
      {([1, 2] as const).map((wave) => {
        const providers = AVAILABLE_PROVIDERS.filter((p) => p.wave === wave && !connectedProviders.has(p.id));
        if (providers.length === 0) return null;
        return (
          <section key={wave} className="space-y-3">
            <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
              {wave === 1 ? (connections.length > 0 ? "Add another" : "Available") : "More connectors"}
            </h2>
            <div className="grid gap-3">
              {providers.map((provider) => (
                <Card key={provider.id} className="flex items-center justify-between px-5 py-4">
                  <div className="flex items-center gap-3">
                    <ProviderLogo provider={provider.id} />
                    <div>
                      <p className="text-sm font-medium">{provider.label}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{provider.description}</p>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={connecting === provider.id}
                    onClick={() => handleConnect(provider)}
                  >
                    {connecting === provider.id ? "Redirecting…" : "Connect"}
                  </Button>
                </Card>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
