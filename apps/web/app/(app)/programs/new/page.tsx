"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type { ValidationResult } from "@/lib/validation";

type Connection = {
  id: string;
  name: string;
  provider: string;
  metadata: { email?: string } | null;
  is_valid: boolean;
};

type GenesisError = {
  error: "INSUFFICIENT_DESCRIPTION" | "MISSING_CONNECTIONS" | "SCHEMA_VALIDATION_FAILED";
  message?: string;
  missing?: string[];
};

type ApiKey = {
  id: string;
  name: string;
  provider: string;
  is_valid: boolean;
};

type Step = "describe" | "connections" | "model" | "generating" | "result";

const PROVIDER_LABELS: Record<string, string> = {
  gmail: "Gmail",
  notion: "Notion",
  slack: "Slack",
  github: "GitHub",
  sheets: "Google Sheets",
};

export default function NewProgramPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("describe");
  const [description, setDescription] = useState("");
  const [connections, setConnections] = useState<Connection[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [loadingConnections, setLoadingConnections] = useState(true);
  const [genesisError, setGenesisError] = useState<GenesisError | null>(null);
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null);
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [loadingKeys, setLoadingKeys] = useState(false);
  const [selectedKeyId, setSelectedKeyId] = useState<string | null>(null);
  const [model, setModel] = useState("");
  const [programId, setProgramId] = useState<string | null>(null);
  const [programName, setProgramName] = useState<string>("");

  useEffect(() => {
    fetch("/api/connections")
      .then((r) => r.json())
      .then((data) => {
        setConnections(data.filter((c: Connection) => c.is_valid));
        setLoadingConnections(false);
      })
      .catch(() => setLoadingConnections(false));
  }, []);

  const DEFAULT_MODELS: Record<string, string> = {
    anthropic: "claude-opus-4-6",
    openai: "gpt-4o",
    google: "gemini-1.5-pro",
    groq: "llama-3.1-70b-versatile",
    mistral: "mistral-large-latest",
    openrouter: "qwen/qwen3.6-plus:free",
  };

  async function loadApiKeys() {
    setLoadingKeys(true);
    const res = await fetch("/api/keys");
    if (res.ok) {
      const data: ApiKey[] = await res.json();
      const valid = data.filter((k) => k.is_valid);
      setApiKeys(valid);
      if (valid.length > 0) {
        setSelectedKeyId(valid[0].id);
        setModel(DEFAULT_MODELS[valid[0].provider] ?? "");
      }
    }
    setLoadingKeys(false);
  }

  function toggleConnection(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function handleGenerate() {
    setStep("generating");
    setGenesisError(null);

    const res = await fetch("/api/genesis", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        description,
        connection_ids: [...selectedIds],
        api_key_id: selectedKeyId,
        model: model.trim(),
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      if (data.error) {
        setGenesisError(data);
      } else {
        setGenesisError({ error: "INSUFFICIENT_DESCRIPTION", message: data.error ?? "Unknown error" });
      }
      setStep("result");
      return;
    }

    setProgramId(data.program.id);
    setProgramName(data.program.name);
    setValidationResult(data.validation);
    setStep("result");
  }

  const errorCount = validationResult?.errors.length ?? 0;
  const warningCount = validationResult?.warnings.length ?? 0;

  return (
    <div className="max-w-2xl space-y-6">
      {/* Step: Describe */}
      {step === "describe" && (
        <>
          <div>
            <h1 className="text-xl font-semibold">New program</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Describe what you want to automate. Be specific about inputs, outputs, and any conditions.
            </p>
          </div>

          <div className="space-y-2">
            <Textarea
              className="min-h-[160px] text-sm"
              placeholder={`Example: "Every morning at 8am, check my Gmail for emails with invoices, extract the amount and sender, save them to a Notion database called 'Invoices', and send me a Slack summary of what was added."`}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              {description.length}/2000 characters
            </p>
          </div>

          <Button
            disabled={description.trim().length < 10}
            onClick={() => setStep("connections")}
          >
            Continue →
          </Button>
        </>
      )}

      {/* Step: Select connections */}
      {step === "connections" && (
        <>
          <div>
            <h1 className="text-xl font-semibold">Select connections</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Choose which connected apps this program can access.
            </p>
          </div>

          {loadingConnections ? (
            <p className="text-sm text-muted-foreground">Loading connections…</p>
          ) : connections.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center space-y-3">
                <p className="text-sm text-muted-foreground">
                  No connections yet. You can still generate without them, or add connections first.
                </p>
                <Button variant="outline" size="sm" onClick={() => router.push("/connections")}>
                  Add connections
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {connections.map((conn) => (
                <button
                  key={conn.id}
                  onClick={() => toggleConnection(conn.id)}
                  className={`w-full flex items-center justify-between rounded-lg border px-4 py-3 text-left transition-colors ${
                    selectedIds.has(conn.id)
                      ? "border-ring bg-accent"
                      : "border-border hover:bg-accent/50"
                  }`}
                >
                  <div>
                    <p className="text-sm font-medium">{conn.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {PROVIDER_LABELS[conn.provider] ?? conn.provider}
                      {conn.metadata?.email && <> · {conn.metadata.email}</>}
                    </p>
                  </div>
                  <div
                    className={`w-4 h-4 rounded-full border-2 transition-colors ${
                      selectedIds.has(conn.id) ? "border-ring bg-ring" : "border-muted-foreground"
                    }`}
                  />
                </button>
              ))}
            </div>
          )}

          <div className="flex gap-3">
            <Button variant="outline" onClick={() => setStep("describe")}>
              ← Back
            </Button>
            <Button onClick={() => { loadApiKeys(); setStep("model"); }}>
              Continue →
            </Button>
          </div>
        </>
      )}

      {/* Step: Select model / API key */}
      {step === "model" && (
        <>
          <div>
            <h1 className="text-xl font-semibold">Choose a model</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Select which API key to use for generating this program.
            </p>
          </div>

          {loadingKeys ? (
            <p className="text-sm text-muted-foreground">Loading keys…</p>
          ) : apiKeys.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center space-y-3">
                <p className="text-sm text-muted-foreground">
                  No API keys yet. Add one to generate programs.
                </p>
                <Button variant="outline" size="sm" onClick={() => router.push("/api-keys")}>
                  Add API key
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {apiKeys.map((k) => (
                <button
                  key={k.id}
                  onClick={() => { setSelectedKeyId(k.id); setModel(DEFAULT_MODELS[k.provider] ?? ""); }}
                  className={`w-full flex items-center justify-between rounded-lg border px-4 py-3 text-left transition-colors ${
                    selectedKeyId === k.id
                      ? "border-ring bg-accent"
                      : "border-border hover:bg-accent/50"
                  }`}
                >
                  <div>
                    <p className="text-sm font-medium">{k.name}</p>
                    <p className="text-xs text-muted-foreground capitalize">{k.provider}</p>
                  </div>
                  <div
                    className={`w-4 h-4 rounded-full border-2 transition-colors ${
                      selectedKeyId === k.id ? "border-ring bg-ring" : "border-muted-foreground"
                    }`}
                  />
                </button>
              ))}
              {selectedKeyId && (
                <div className="pt-2">
                  <Label htmlFor="model">Model</Label>
                  <Input
                    id="model"
                    className="mt-1"
                    placeholder="e.g. claude-opus-4-6 or anthropic/claude-opus-4-6"
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    For OpenRouter use format: <span className="font-mono">anthropic/claude-opus-4-6</span>
                  </p>
                </div>
              )}
            </div>
          )}

          <div className="flex gap-3">
            <Button variant="outline" onClick={() => setStep("connections")}>
              ← Back
            </Button>
            <Button disabled={!selectedKeyId || !model.trim()} onClick={handleGenerate}>
              Generate program
            </Button>
          </div>
        </>
      )}

      {/* Generating */}
      {step === "generating" && (
        <div className="py-20 text-center space-y-3">
          <div className="inline-flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner />
            Generating your program…
          </div>
          <p className="text-xs text-muted-foreground">
            Claude is designing the graph schema. This usually takes 10–20 seconds.
          </p>
        </div>
      )}

      {/* Result */}
      {step === "result" && (
        <>
          {genesisError ? (
            <div className="space-y-4">
              <div className="rounded-md bg-destructive/10 border border-destructive/20 text-destructive px-4 py-3 text-sm space-y-1">
                <p className="font-medium">
                  {genesisError.error === "INSUFFICIENT_DESCRIPTION" ? "Description too vague"
                    : genesisError.error === "MISSING_CONNECTIONS" ? "Missing connections"
                    : genesisError.error === "SCHEMA_VALIDATION_FAILED" ? "Schema validation failed"
                    : "Generation failed"}
                </p>
                {genesisError.message && <p>{genesisError.message}</p>}
                {!genesisError.message && genesisError.error !== "INSUFFICIENT_DESCRIPTION" && genesisError.error !== "MISSING_CONNECTIONS" && genesisError.error !== "SCHEMA_VALIDATION_FAILED" && (
                  <p>{genesisError.error}</p>
                )}
                {genesisError.missing && (
                  <p>Required: {genesisError.missing.join(", ")}</p>
                )}
              </div>
              <Button variant="outline" onClick={() => setStep("describe")}>
                ← Try again
              </Button>
            </div>
          ) : (
            <div className="space-y-6">
              <div>
                <h1 className="text-xl font-semibold">{programName}</h1>
                <p className="text-sm text-muted-foreground mt-0.5">Program generated successfully.</p>
              </div>

              {validationResult && (errorCount > 0 || warningCount > 0) && (
                <div className="rounded-md border border-border p-4 space-y-2">
                  <p className="text-sm font-medium">Validation</p>
                  <div className="flex gap-2">
                    {errorCount > 0 && (
                      <Badge variant="destructive">{errorCount} error{errorCount !== 1 ? "s" : ""}</Badge>
                    )}
                    {warningCount > 0 && (
                      <Badge variant="warning">{warningCount} warning{warningCount !== 1 ? "s" : ""}</Badge>
                    )}
                  </div>
                  <div className="space-y-1">
                    {validationResult.errors.map((e, i) => (
                      <p key={i} className="text-xs text-destructive">{e.message}</p>
                    ))}
                    {validationResult.warnings.map((w, i) => (
                      <p key={i} className="text-xs text-yellow-600 dark:text-yellow-400">{w.message}</p>
                    ))}
                  </div>
                </div>
              )}

              {validationResult?.valid && (
                <div className="rounded-md bg-green-500/10 border border-green-500/20 text-green-700 dark:text-green-400 px-4 py-3 text-sm">
                  Schema is valid and ready.
                </div>
              )}

              <div className="flex gap-3">
                <Button onClick={() => router.push(`/programs/${programId}`)}>
                  Open program →
                </Button>
                <Button variant="outline" onClick={() => router.push("/dashboard")}>
                  Back to dashboard
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Spinner() {
  return (
    <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}
