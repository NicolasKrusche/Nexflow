import { NextResponse } from "next/server";
import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { createServerClient } from "@/lib/supabase/server";
import { apiError, createServiceClient } from "@/lib/api";
import { vaultRetrieve } from "@/lib/vault";
import { GENESIS_SYSTEM_PROMPT, buildGenesisUserMessage } from "@/lib/genesis/prompt";
import { ProgramSchemaZ } from "@flowos/schema";
import { validatePostGenesis } from "@/lib/validation";

const RequestSchema = z.object({
  description: z.string().min(10).max(2000),
  connection_ids: z.array(z.string().uuid()).max(10),
  api_key_id: z.string().uuid(),
  model: z.string().min(1),
});

// POST /api/genesis — generate a program schema from a description
export async function POST(request: Request) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiError("Unauthorized", 401);

  const body = await request.json().catch(() => null);
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) return apiError(parsed.error.message, 400);

  const { description, connection_ids, api_key_id, model } = parsed.data;

  // Resolve the selected connections
  const { data: connections, error: connError } = await supabase
    .from("connections")
    .select("id, name, provider, scopes")
    .in("id", connection_ids)
    .eq("user_id", user.id);

  if (connError) return apiError(connError.message, 500);

  const availableConnections = (connections ?? []).map((c) => ({
    name: c.name,
    type: c.provider,
    scopes: c.scopes ?? [],
  }));

  // Fetch the selected API key from Vault
  const serviceClient = createServiceClient();
  const { data: apiKeyRow, error: keysError } = await serviceClient
    .from("api_keys")
    .select("vault_secret_id, provider")
    .eq("id", api_key_id)
    .eq("user_id", user.id)
    .single();

  if (keysError || !apiKeyRow) {
    return apiError("API key not found. Please select a valid key.", 402);
  }

  let anthropicApiKey: string;
  try {
    anthropicApiKey = await vaultRetrieve(serviceClient, apiKeyRow.vault_secret_id);
  } catch (err) {
    return apiError(`Failed to retrieve API key: ${(err as Error).message}`, 500);
  }

  // Call the model — use OpenAI-compatible SDK for OpenRouter/OpenAI/etc, Anthropic SDK for Anthropic
  const useAnthropicSDK = apiKeyRow.provider === "anthropic";

  // Transient provider errors that are safe to retry (OpenRouter 524 timeout, 529 overloaded, etc.)
  const isRetryable = (err: unknown): boolean => {
    const msg = err instanceof Error ? err.message : String(err);
    return (
      msg.includes("524") ||
      msg.includes("529") ||
      msg.includes("Provider returned error") ||
      msg.includes("overloaded") ||
      msg.includes("timeout") ||
      msg.includes("ECONNRESET") ||
      msg.includes("ETIMEDOUT")
    );
  };

  let rawText: string;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      if (useAnthropicSDK) {
        const anthropic = new Anthropic({ apiKey: anthropicApiKey });
        const msg = await anthropic.messages.create({
          model,
          max_tokens: 4096,
          system: GENESIS_SYSTEM_PROMPT,
          messages: [{ role: "user", content: buildGenesisUserMessage(description, availableConnections) }],
        });
        rawText = msg.content[0]?.type === "text" ? (msg.content[0] as { type: "text"; text: string }).text : "";
      } else {
        const baseURL = apiKeyRow.provider === "openrouter"
          ? "https://openrouter.ai/api/v1"
          : apiKeyRow.provider === "openai"
            ? "https://api.openai.com/v1"
            : apiKeyRow.provider === "groq"
              ? "https://api.groq.com/openai/v1"
              : apiKeyRow.provider === "mistral"
                ? "https://api.mistral.ai/v1"
                : undefined;

        const openai = new OpenAI({ apiKey: anthropicApiKey, ...(baseURL && { baseURL }), timeout: 120_000 });
        const msg = await openai.chat.completions.create({
          model,
          max_tokens: 4096,
          messages: [
            { role: "system", content: GENESIS_SYSTEM_PROMPT },
            { role: "user", content: buildGenesisUserMessage(description, availableConnections) },
          ],
        });
        // Some OpenRouter models return choices=undefined or an empty array on failure
        if (!msg.choices?.length) {
          const raw = msg as unknown as Record<string, unknown>;
          const hint = raw.error ?? raw.detail ?? raw.message;
          const errMsg = hint
            ? `OpenRouter error: ${typeof hint === "object" ? JSON.stringify(hint) : hint}`
            : `Model returned no choices (model="${model}" may be unavailable or rate-limited). Full response: ${JSON.stringify(raw).slice(0, 400)}`;
          const e = new Error(errMsg);
          if (isRetryable(e) && attempt < 3) {
            lastErr = e;
            await new Promise((r) => setTimeout(r, attempt * 2000));
            continue;
          }
          throw e;
        }
        rawText = msg.choices[0].message?.content ?? "";
      }
      break; // success
    } catch (err) {
      lastErr = err;
      if (isRetryable(err) && attempt < 3) {
        await new Promise((r) => setTimeout(r, attempt * 2000));
        continue;
      }
      return apiError(`Genesis model call failed: ${(err as Error).message}`, 502);
    }
  }
  if (!rawText!) {
    return apiError(`Genesis model call failed after 3 attempts: ${(lastErr as Error)?.message ?? "empty response"}`, 502);
  }

  // Strip markdown code fences if the model wrapped the JSON (common with non-Anthropic models)
  const cleanedText = rawText
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  // Parse and validate the response
  let parsed_schema: unknown;
  try {
    parsed_schema = JSON.parse(cleanedText);
  } catch {
    console.error("[genesis] Failed to parse JSON. Raw output:", rawText.slice(0, 1000));
    return apiError("Genesis model returned invalid JSON", 502);
  }

  // Check for genesis error signals
  if (
    parsed_schema &&
    typeof parsed_schema === "object" &&
    "error" in parsed_schema
  ) {
    return NextResponse.json(parsed_schema, { status: 422 });
  }

  // Replace __GENERATED__ program_id with a real UUID
  if (
    parsed_schema &&
    typeof parsed_schema === "object" &&
    "program_id" in parsed_schema &&
    (parsed_schema as Record<string, unknown>).program_id === "__GENERATED__"
  ) {
    (parsed_schema as Record<string, unknown>).program_id = crypto.randomUUID();
  }

  // Normalize common model deviations before strict Zod validation
  normalizeSchema(parsed_schema);

  const schemaResult = ProgramSchemaZ.safeParse(parsed_schema);
  if (!schemaResult.success) {
    console.error("[genesis] Schema validation failed:", JSON.stringify(schemaResult.error.flatten(), null, 2));
    console.error("[genesis] Raw model output:", rawText.slice(0, 2000));
    return NextResponse.json(
      {
        error: "SCHEMA_VALIDATION_FAILED",
        details: schemaResult.error.flatten(),
        raw: parsed_schema,
      },
      { status: 422 }
    );
  }

  const schema = schemaResult.data;

  // Run post-genesis validation
  const validation = validatePostGenesis(schema, connections ?? []);

  // Persist the program
  const { data: program, error: insertError } = await supabase
    .from("programs")
    .insert({
      user_id: user.id,
      name: schema.program_name,
      description,
      schema: schema as unknown as Record<string, unknown>,
      execution_mode: schema.execution_mode === "approval_required" ? "supervised" : schema.execution_mode,
    })
    .select("id, name, description, execution_mode, is_active, created_at")
    .single();

  if (insertError) return apiError(insertError.message, 500);

  // Link connections
  if (connection_ids.length > 0) {
    const { error: connLinkErr } = await supabase.from("program_connections").insert(
      connection_ids.map((cid) => ({ program_id: program.id, connection_id: cid }))
    );
    if (connLinkErr) console.error("[genesis] Failed to link connections:", connLinkErr.message);
  }

  // Store genesis snapshot as version 0
  const { error: versionErr } = await supabase.from("program_versions").insert({
    program_id: program.id,
    version: 0,
    schema: schema as unknown as Record<string, unknown>,
    change_summary: "Genesis — AI-generated from description",
  });
  if (versionErr) console.error("[genesis] Failed to store version snapshot:", versionErr.message);

  return NextResponse.json({ program, schema, validation }, { status: 201 });
}

// ─── Schema normalization ──────────────────────────────────────────────────
// Fixes known deviations that non-Anthropic models commonly produce, so that
// the strict Zod validator doesn't reject otherwise-valid schemas.

const TRIGGER_TYPE_MAP: Record<string, string> = {
  schedule: "cron",
  scheduled: "cron",
  cron_job: "cron",
  cronjob: "cron",
  timer: "cron",
  time: "cron",
  interval: "cron",
  http: "webhook",
  http_webhook: "webhook",
  incoming_webhook: "webhook",
};

const DATA_TYPE_MAP: Record<string, string> = {
  integer: "number",
  int: "number",
  float: "number",
  double: "number",
  long: "number",
  decimal: "number",
  dict: "object",
  list: "array",
};

function normalizeDataSchema(schema: unknown): void {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return;
  const s = schema as Record<string, unknown>;
  if (typeof s.type === "string" && DATA_TYPE_MAP[s.type]) {
    s.type = DATA_TYPE_MAP[s.type];
  }
  if (s.properties && typeof s.properties === "object") {
    for (const v of Object.values(s.properties)) normalizeDataSchema(v);
  }
  if (s.items) normalizeDataSchema(s.items);
}

const VALID_NODE_TYPES = new Set(["trigger", "agent", "step", "connection"]);

// Maps unrecognized node type strings to valid ones
const NODE_TYPE_MAP: Record<string, string> = {
  action: "connection",
  connector: "connection",
  integration: "connection",
  api: "connection",
  service: "connection",
  decision: "step",
  condition: "step",
  filter_node: "step",
  loop: "step",
  transform_node: "step",
  branch_node: "step",
  schedule: "trigger",
  scheduled: "trigger",
  cron: "trigger",
  timer: "trigger",
  webhook: "trigger",
  llm: "agent",
  ai: "agent",
  model: "agent",
  assistant: "agent",
  task: "step",
  router: "step",
  switcher: "step",
  mapper: "step",
};

function inferNodeType(config: Record<string, unknown>): string | null {
  if ("trigger_type" in config) return "trigger";
  if ("logic_type" in config) return "step";
  if ("model" in config && "system_prompt" in config) return "agent";
  if ("scope_access" in config || "connector_type" in config) return "connection";
  return null;
}

function normalizeSchema(raw: unknown): void {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;
  const schema = raw as Record<string, unknown>;

  // Normalize nodes
  if (Array.isArray(schema.nodes)) {
    for (const node of schema.nodes) {
      if (!node || typeof node !== "object") continue;
      const n = node as Record<string, unknown>;

      // Fix unrecognized node types
      if (typeof n.type === "string" && !VALID_NODE_TYPES.has(n.type)) {
        const mapped = NODE_TYPE_MAP[n.type.toLowerCase()];
        if (mapped) {
          n.type = mapped;
        } else if (n.config && typeof n.config === "object") {
          const inferred = inferNodeType(n.config as Record<string, unknown>);
          if (inferred) n.type = inferred;
        }
      }

      // Fix trigger config — models often omit trigger_type or use wrong field names
      if (n.type === "trigger" && n.config && typeof n.config === "object") {
        const cfg = n.config as Record<string, unknown>;

        // Normalize known trigger_type aliases
        if (typeof cfg.trigger_type === "string" && TRIGGER_TYPE_MAP[cfg.trigger_type]) {
          cfg.trigger_type = TRIGGER_TYPE_MAP[cfg.trigger_type];
        }

        // Infer trigger_type from fields if missing or still wrong
        const validTriggerTypes = new Set(["cron", "event", "webhook", "manual", "program_output"]);
        if (!cfg.trigger_type || !validTriggerTypes.has(cfg.trigger_type as string)) {
          if (cfg.schedule || cfg.expression || cfg.cron || cfg.cron_expression) {
            cfg.trigger_type = "cron";
          } else if (cfg.endpoint_id || cfg.url || cfg.path || cfg.webhook_url) {
            cfg.trigger_type = "webhook";
          } else if (cfg.source && cfg.event) {
            cfg.trigger_type = "event";
          } else if (cfg.source_program_id) {
            cfg.trigger_type = "program_output";
          } else {
            cfg.trigger_type = "manual";
          }
        }

        // Normalize cron field names and fill required fields
        if (cfg.trigger_type === "cron") {
          if (!cfg.expression) {
            cfg.expression = cfg.cron_expression ?? cfg.schedule ?? cfg.cron ?? "0 8 * * *";
          }
          delete cfg.schedule;
          delete cfg.cron;
          delete cfg.cron_expression;
          if (!cfg.timezone) cfg.timezone = "UTC";
        }

        // Normalize webhook required fields
        if (cfg.trigger_type === "webhook") {
          if (!cfg.endpoint_id) cfg.endpoint_id = crypto.randomUUID();
          if (!cfg.method) cfg.method = "POST";
        }

        // Normalize event required fields
        if (cfg.trigger_type === "event") {
          if (!cfg.source) cfg.source = "unknown";
          if (!cfg.event) cfg.event = "trigger";
          if (!("filter" in cfg)) cfg.filter = null;
        }

        // Normalize program_output required fields
        if (cfg.trigger_type === "program_output") {
          if (!cfg.source_program_id) cfg.source_program_id = "__USER_ASSIGNED__";
          if (!Array.isArray(cfg.on_status)) cfg.on_status = ["success"];
        }
      }

      // Fix DataSchema type fields on agent nodes
      if (n.type === "agent" && n.config && typeof n.config === "object") {
        const cfg = n.config as Record<string, unknown>;
        normalizeDataSchema(cfg.input_schema);
        normalizeDataSchema(cfg.output_schema);
      }

      // Fix DataSchema on step nodes; also enforce connection: null (required by schema)
      if (n.type === "step" && n.config && typeof n.config === "object") {
        const cfg = n.config as Record<string, unknown>;
        normalizeDataSchema(cfg.input_schema);
        normalizeDataSchema(cfg.output_schema);
        normalizeDataSchema(cfg.pass_schema);
        n.connection = null;
      }

      // Normalize connection node config
      if (n.type === "connection" && n.config && typeof n.config === "object") {
        const cfg = n.config as Record<string, unknown>;
        // If model set connector_type to something other than "http", strip it so the
        // OAuth union branch matches (connector_type is optional there).
        if (cfg.connector_type && cfg.connector_type !== "http") {
          delete cfg.connector_type;
        }
        // Ensure scope_required is an array (models sometimes emit a string)
        if (typeof cfg.scope_required === "string") {
          cfg.scope_required = [cfg.scope_required];
        } else if (!Array.isArray(cfg.scope_required)) {
          cfg.scope_required = [];
        }
        // Ensure scope_access has a valid value (required by OAuth branch)
        const validScopeAccess = new Set(["read", "write", "read_write"]);
        if (!cfg.scope_access || !validScopeAccess.has(cfg.scope_access as string)) {
          cfg.scope_access = "read_write";
        }
        // Strip empty operation/operation_params so optional fields are truly absent
        if (cfg.operation === "" || cfg.operation === null) delete cfg.operation;
        if (cfg.operation_params === null || (typeof cfg.operation_params === "object" && Object.keys(cfg.operation_params as object).length === 0)) {
          delete cfg.operation_params;
        }
      }

      // Ensure status is always "idle"
      if (!n.status) n.status = "idle";
    }
  }

  // Normalize top-level triggers array — sync type with the corresponding node's trigger_type
  if (Array.isArray(schema.triggers) && Array.isArray(schema.nodes)) {
    for (const trigger of schema.triggers) {
      if (!trigger || typeof trigger !== "object") continue;
      const t = trigger as Record<string, unknown>;

      // Try to sync from the node config first (most reliable after node normalization above)
      const triggerNode = (schema.nodes as Record<string, unknown>[]).find(
        (n) => n.id === t.node_id && n.type === "trigger"
      );
      if (triggerNode?.config && typeof triggerNode.config === "object") {
        const nodeCfg = triggerNode.config as Record<string, unknown>;
        if (nodeCfg.trigger_type) {
          t.type = nodeCfg.trigger_type;
        }
      }

      // Fallback: normalize aliases
      if (typeof t.type === "string" && TRIGGER_TYPE_MAP[t.type]) {
        t.type = TRIGGER_TYPE_MAP[t.type];
      }

      // Ensure required fields exist
      if (!("is_active" in t)) t.is_active = true;
      if (!("last_fired" in t)) t.last_fired = null;
      if (!("next_scheduled" in t)) t.next_scheduled = null;
    }
  }
}
