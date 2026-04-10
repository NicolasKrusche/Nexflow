"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type ImportSource = "file" | "code";

type ImportResult = {
  program: {
    id: string;
    name: string;
  };
  validation: {
    valid: boolean;
    errors: unknown[];
    warnings: unknown[];
  };
  missing_connection_names: string[];
};

function getImportErrorMessage(payload: unknown): string {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return "Import failed. Please check your JSON and try again.";
  }

  const obj = payload as Record<string, unknown>;
  if (typeof obj.error === "string" && obj.error.trim().length > 0) return obj.error;

  if (obj.details && typeof obj.details === "object" && !Array.isArray(obj.details)) {
    const details = obj.details as Record<string, unknown>;
    if (Array.isArray(details.formErrors) && details.formErrors.length > 0) {
      const first = details.formErrors[0];
      if (typeof first === "string") return first;
    }
  }

  return "Import failed. Please check your JSON and try again.";
}

export default function ImportProgramPage() {
  const router = useRouter();
  const [source, setSource] = useState<ImportSource>("file");
  const [jsonCode, setJsonCode] = useState("");
  const [jsonFile, setJsonFile] = useState<File | null>(null);
  const [nameOverride, setNameOverride] = useState("");
  const [descriptionOverride, setDescriptionOverride] = useState("");
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  async function handleImport() {
    setImporting(true);
    setError(null);
    setResult(null);

    try {
      let rawJson = "";
      if (source === "file") {
        if (!jsonFile) {
          setError("Select a JSON file before importing.");
          return;
        }
        rawJson = await jsonFile.text();
      } else {
        rawJson = jsonCode;
      }

      if (!rawJson.trim()) {
        setError("JSON input is empty.");
        return;
      }

      const res = await fetch("/api/programs/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          json: rawJson,
          name: nameOverride.trim() || undefined,
          description: descriptionOverride.trim() || undefined,
        }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(getImportErrorMessage(data));
        return;
      }

      setResult(data as ImportResult);
    } catch {
      setError("Could not import this file. Please try again.");
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <p className="text-sm text-muted-foreground mb-1">
          <Link href="/dashboard" className="hover:underline">
            Dashboard
          </Link>
        </p>
        <h1 className="text-2xl font-semibold">Import program</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Import a full Program schema either from a JSON file or by pasting JSON code.
        </p>
      </div>

      {!result ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Program JSON</CardTitle>
            <CardDescription>
              Accepted formats: raw ProgramSchema JSON, JSON wrapped in markdown code fences, or objects with a
              top-level <span className="font-mono">schema</span> field.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant={source === "file" ? "default" : "outline"}
                size="sm"
                onClick={() => setSource("file")}
              >
                Upload file
              </Button>
              <Button
                type="button"
                variant={source === "code" ? "default" : "outline"}
                size="sm"
                onClick={() => setSource("code")}
              >
                Paste code
              </Button>
            </div>

            {source === "file" ? (
              <div className="space-y-2">
                <Label htmlFor="json-file">JSON file</Label>
                <Input
                  id="json-file"
                  type="file"
                  accept=".json,application/json"
                  onChange={(e) => setJsonFile(e.target.files?.[0] ?? null)}
                />
              </div>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="json-code">JSON code</Label>
                <Textarea
                  id="json-code"
                  className="min-h-[260px] font-mono text-xs"
                  placeholder='Paste your JSON here (for example: {"version":"1.0", ...})'
                  value={jsonCode}
                  onChange={(e) => setJsonCode(e.target.value)}
                />
              </div>
            )}

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="name-override">Program name (optional)</Label>
                <Input
                  id="name-override"
                  placeholder="Use name from JSON if empty"
                  value={nameOverride}
                  onChange={(e) => setNameOverride(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="description-override">Description (optional)</Label>
                <Input
                  id="description-override"
                  placeholder="Use description from JSON if empty"
                  value={descriptionOverride}
                  onChange={(e) => setDescriptionOverride(e.target.value)}
                />
              </div>
            </div>

            {error && (
              <p className="rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            )}

            <div className="flex gap-3">
              <Button type="button" onClick={handleImport} disabled={importing}>
                {importing ? "Importing..." : "Import program"}
              </Button>
              <Button type="button" variant="outline" asChild>
                <Link href="/dashboard">Cancel</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Import successful</CardTitle>
            <CardDescription>
              <span className="font-medium">{result.program.name}</span> was imported.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Validation: {result.validation.errors.length} error(s), {result.validation.warnings.length} warning(s)
            </p>

            {result.missing_connection_names.length > 0 && (
              <div className="rounded-md border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-sm text-yellow-700 dark:text-yellow-400">
                Missing connections: {result.missing_connection_names.join(", ")}
              </div>
            )}

            <div className="flex gap-3">
              <Button type="button" onClick={() => router.push(`/programs/${result.program.id}`)}>
                Open program
              </Button>
              <Button type="button" variant="outline" onClick={() => {
                setResult(null);
                setError(null);
                setJsonCode("");
                setJsonFile(null);
              }}>
                Import another
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
