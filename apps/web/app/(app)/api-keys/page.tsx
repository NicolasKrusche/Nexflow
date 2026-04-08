"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type ApiKey = {
  id: string;
  name: string;
  provider: string;
  is_valid: boolean;
  last_validated_at: string | null;
  created_at: string;
};

const PROVIDERS = [
  { value: "anthropic", label: "Anthropic" },
  { value: "openai", label: "OpenAI" },
  { value: "openrouter", label: "OpenRouter" },
  { value: "google", label: "Google (Gemini)" },
  { value: "mistral", label: "Mistral" },
  { value: "cohere", label: "Cohere" },
  { value: "groq", label: "Groq" },
  { value: "other", label: "Other" },
] as const;

export default function ApiKeysPage() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({ name: "", provider: "anthropic", customProvider: "", key: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validating, setValidating] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const res = await fetch("/api/keys");
    if (res.ok) setKeys(await res.json());
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const provider = form.provider === "other" ? form.customProvider.trim().toLowerCase() : form.provider;
    const res = await fetch("/api/keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: form.name, provider, key: form.key }),
    });
    if (res.ok) {
      setDialogOpen(false);
      setForm({ name: "", provider: "anthropic", customProvider: "", key: "" });
      load();
    } else {
      const data = await res.json();
      setError(data.error ?? "Failed to save key");
    }
    setSaving(false);
  }

  async function handleValidate(id: string) {
    setValidating(id);
    await fetch(`/api/keys/${id}`, { method: "POST" });
    load();
    setValidating(null);
  }

  async function handleDelete(id: string) {
    setDeleting(id);
    await fetch(`/api/keys/${id}`, { method: "DELETE" });
    setKeys((prev) => prev.filter((k) => k.id !== id));
    setDeleting(null);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">API Keys</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Your AI provider keys are encrypted and stored securely. They never appear in logs.
          </p>
        </div>
        <Button onClick={() => setDialogOpen(true)}>Add key</Button>
      </div>

      {loading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : keys.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No API keys yet. Add one to start running agents.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {keys.map((key) => (
            <Card key={key.id}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <CardTitle className="text-sm">{key.name}</CardTitle>
                    <CardDescription className="text-xs mt-0.5">
                      {PROVIDERS.find((p) => p.value === key.provider)?.label ?? key.provider}
                      {key.last_validated_at && (
                        <> · Validated {new Date(key.last_validated_at).toLocaleDateString()}</>
                      )}
                    </CardDescription>
                  </div>
                  <Badge variant={key.is_valid ? "success" : "destructive"}>
                    {key.is_valid ? "Valid" : "Invalid"}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="pt-0 flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={validating === key.id}
                  onClick={() => handleValidate(key.id)}
                >
                  {validating === key.id ? "Checking…" : "Validate"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-destructive hover:text-destructive"
                  disabled={deleting === key.id}
                  onClick={() => handleDelete(key.id)}
                >
                  {deleting === key.id ? "Removing…" : "Remove"}
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <form onSubmit={handleAdd}>
            <DialogHeader>
              <DialogTitle>Add API key</DialogTitle>
              <DialogDescription>
                The key is encrypted immediately and never stored in plaintext.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              <div>
                <Label htmlFor="provider">Provider</Label>
                <Select
                  id="provider"
                  className="mt-1"
                  value={form.provider}
                  onChange={(e) => setForm((f) => ({ ...f, provider: e.target.value, customProvider: "" }))}
                >
                  {PROVIDERS.map((p) => (
                    <option key={p.value} value={p.value}>{p.label}</option>
                  ))}
                </Select>
                {form.provider === "other" && (
                  <Input
                    className="mt-2"
                    placeholder="Provider name (e.g. together-ai)"
                    required
                    value={form.customProvider}
                    onChange={(e) => setForm((f) => ({ ...f, customProvider: e.target.value }))}
                  />
                )}
              </div>
              <div>
                <Label htmlFor="name">Label</Label>
                <Input
                  id="name"
                  className="mt-1"
                  placeholder="e.g. Production Anthropic"
                  required
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                />
              </div>
              <div>
                <Label htmlFor="key">API key</Label>
                <Input
                  id="key"
                  type="password"
                  className="mt-1"
                  placeholder="sk-…"
                  required
                  value={form.key}
                  onChange={(e) => setForm((f) => ({ ...f, key: e.target.value }))}
                />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? "Saving…" : "Save key"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
