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
  notion: "Notion",
  slack: "Slack",
  github: "GitHub",
  sheets: "Google Sheets",
};

const AVAILABLE_PROVIDERS = [
  { id: "gmail", label: "Gmail", description: "Send and read emails via Gmail OAuth", authType: "oauth" },
  { id: "notion", label: "Notion", description: "Read and write Notion pages and databases", authType: "oauth" },
  { id: "slack", label: "Slack", description: "Post messages and read channels", authType: "oauth" },
  { id: "github", label: "GitHub", description: "Create issues, PRs, and read repos", authType: "oauth" },
  { id: "sheets", label: "Google Sheets", description: "Read and write spreadsheet data", authType: "oauth" },
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

  function handleConnect(provider: string) {
    setConnecting(provider);
    if (provider === "gmail") {
      window.location.href = `/api/connections/oauth/gmail?label=gmail:primary`;
    } else {
      setConnecting(null);
      alert(`${provider} OAuth is coming soon.`);
    }
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
      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
          {connections.length > 0 ? "Add another" : "Available"}
        </h2>
        <div className="grid gap-3">
          {AVAILABLE_PROVIDERS.filter((p) => !connectedProviders.has(p.id)).map((provider) => (
            <Card key={provider.id} className="flex items-center justify-between px-5 py-4">
              <div>
                <p className="text-sm font-medium">{provider.label}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{provider.description}</p>
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={connecting === provider.id}
                onClick={() => handleConnect(provider.id)}
              >
                {connecting === provider.id ? "Redirecting…" : "Connect"}
              </Button>
            </Card>
          ))}
          {AVAILABLE_PROVIDERS.every((p) => connectedProviders.has(p.id)) && (
            <p className="text-sm text-muted-foreground">All available providers are connected.</p>
          )}
        </div>
      </section>
    </div>
  );
}
