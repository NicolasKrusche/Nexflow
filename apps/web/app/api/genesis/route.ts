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

  let rawText: string;
  try {
    if (useAnthropicSDK) {
      const anthropic = new Anthropic({ apiKey: anthropicApiKey });
      const msg = await anthropic.messages.create({
        model,
        max_tokens: 4096,
        system: GENESIS_SYSTEM_PROMPT,
        messages: [{ role: "user", content: buildGenesisUserMessage(description, availableConnections) }],
      });
      rawText = msg.content[0].type === "text" ? msg.content[0].text : "";
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

      const openai = new OpenAI({ apiKey: anthropicApiKey, ...(baseURL && { baseURL }) });
      const msg = await openai.chat.completions.create({
        model,
        max_tokens: 4096,
        messages: [
          { role: "system", content: GENESIS_SYSTEM_PROMPT },
          { role: "user", content: buildGenesisUserMessage(description, availableConnections) },
        ],
      });
      rawText = msg.choices[0]?.message?.content ?? "";
    }
  } catch (err) {
    return apiError(`Genesis model call failed: ${(err as Error).message}`, 502);
  }

  // Parse and validate the response
  let parsed_schema: unknown;
  try {
    parsed_schema = JSON.parse(rawText.trim());
  } catch {
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

  const schemaResult = ProgramSchemaZ.safeParse(parsed_schema);
  if (!schemaResult.success) {
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
    await supabase.from("program_connections").insert(
      connection_ids.map((cid) => ({ program_id: program.id, connection_id: cid }))
    );
  }

  // Store genesis snapshot as version 0
  await supabase.from("program_versions").insert({
    program_id: program.id,
    version: 0,
    schema: schema as unknown as Record<string, unknown>,
    change_summary: "Genesis — AI-generated from description",
  });

  return NextResponse.json({ program, schema, validation }, { status: 201 });
}
