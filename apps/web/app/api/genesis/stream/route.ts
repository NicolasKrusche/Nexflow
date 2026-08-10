import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { jsonrepair } from "jsonrepair";

export const maxDuration = 300;

import { createServerClient } from "@/lib/supabase/server";
import { apiError, createServiceClient } from "@/lib/api";
import { vaultRetrieve } from "@/lib/vault";
import {
  buildAgentSystemPrompt,
  buildAgentUserMessage,
  buildGenesisSystemPrompt,
  buildGenesisUserMessage,
  buildRefinementUserMessage,
} from "@/lib/genesis/prompt";
import {
  pickEuComplianceFilterKey,
  runEuComplianceFilter,
} from "@/lib/genesis/eu-compliance";
import { ProgramSchemaZ } from "@flowos/schema";
import type { ProgramSchema } from "@flowos/schema";
import { layoutSchema, DEFAULT_LAYOUT_DIRECTION } from "@/lib/schema/layout";
import { validatePostGenesis } from "@/lib/validation";
import {
  getDraftValidationMessage,
  normalizeProgramDraft,
  pruneUnresolvedReferences,
  validateProgramDraft,
} from "@/lib/workflow/normalize";
import { checkAgentAccess, checkProgramLimit, consumeGenesisBonus, recordGenesisUse, refundGenesisBonus } from "@/lib/limits";
import { estimateGenesisCredits, estimateTokens } from "@/lib/genesis/credit-cost";
import { checkGenesisAffordability, chargeGenesisUsage } from "@/lib/genesis/billing";
import type { ModelPricing } from "@/lib/genesis/platform-models";
import { rateLimit } from "@/lib/rate-limit";
import { truncateForLog, writeAppLog } from "@/lib/app-logs";
import { assignAgentNodeDefaults, extractJson, normalizeSchema } from "@/lib/genesis/parsing";
import { applyDeterministicRepairs, createRepairModelCaller, repairMissingOperationParams } from "@/lib/genesis/semantic-repair";
import { buildPlanSystemPrompt } from "@/lib/genesis/plan-prompt";
import { collectPendingConnectionGroups, resolvePendingConnections } from "@/lib/genesis/decomposed-generation";
import { PartialSchemaScanner } from "@/lib/genesis/partial-schema";
import { hasPiiRedactions, PseudonymizationSession } from "@/lib/privacy/pii";
import { buildCapabilityNamesSection, buildCapabilitySection, buildCapabilitySectionsByProvider, fetchConnectionCapabilities, summarizeCapabilities, type CapabilityDescriptor } from "@/lib/genesis/introspection";
import { buildAmbiguityClarification, findAmbiguousTargets } from "@/lib/genesis/ambiguity-detection";
import {
  applyGenesisPatch,
  diffSchemas,
  GenesisPatchZ,
  isGenesisPatch,
  type GenesisPatchSummary,
} from "@/lib/genesis/patch";
import { extractClarifications, MAX_CLARIFICATIONS, type GenesisClarification } from "@/lib/genesis/clarifications";
import { hasTechnicalAccess } from "@/lib/admin-auth";
import { serverLog } from "@/lib/server-log";
import { type LlmUsageLike } from "@/lib/llm-usage-log";
import { getUserAiContext } from "@/lib/onboarding/profile";
import { syncCronTriggers, syncEventTriggers, syncFileWatchTriggers, syncWebhookTriggers } from "@/lib/triggers/event-trigger-sync";
import { ensureProcessingAllowed } from "@/lib/compliance";
import { canContributeToWorkspace, canEdit, canRunAgentInWorkspace, canView, getActiveWorkspace, getProgramAccess } from "@/lib/workspaces";
import {
  GENESIS_MAX_TOKENS,
  GENESIS_TEMPERATURE,
  GenesisRequestSchema,
  getAllowedPlatformModels,
  getMissingConnectionIds,
  getModelCandidates,
  getProviderBaseURL,
  isGenesisRefinementRequest,
  isKeyError,
  isPromptTooLarge,
  isRetryableModelError,
  KEY_DEFAULT_MODELS,
  mapExecutionMode,
  PLATFORM_DEFAULT_MODEL,
  sortApiKeyFallbacks,
  supportsOpenAiJsonMode,
  toGenesisConnectionList,
  toProgramConnectionLinks,
  uniqueRequestedConnectionIds,
  type GenesisApiKeyRow,
  type GenesisConnectionRow,
} from "@/lib/genesis/request";
import { getOpenRouterModelCatalog } from "@/lib/genesis/openrouter-models";
import { getUserTier } from "@/lib/limits";
import { getEntitlements } from "@/lib/entitlements";

// Default platform model — used when the user hasn't picked one.
// Paid-tier users may override this via the `model` field in the request.
const PLATFORM_MODEL = PLATFORM_DEFAULT_MODEL;

type StreamEvent =
  | { type: "meta"; program_name: string }
  | { type: "node"; node: unknown }
  | { type: "edge"; edge: unknown }
  | { type: "status"; message: string }
  | {
      type: "done";
      program_id: string;
      program_name: string;
      validation: unknown;
      schema?: unknown;
      patch?: GenesisPatchSummary | null;
      session_id?: string;
      clarifications?: GenesisClarification[];
    }
  | { type: "question"; session_id: string; clarifications: GenesisClarification[] }
  | { type: "error"; message: string; code?: string };

export async function POST(request: Request) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiError("Unauthorized", 401);
  const userId = user.id;

  // Stage 0: body parse + processing restriction check are independent — run in parallel
  const [processingRestriction, body] = await Promise.all([
    ensureProcessingAllowed(userId),
    request.json().catch(() => null),
  ]);
  if (processingRestriction) return processingRestriction;

  const parsed = GenesisRequestSchema.safeParse(body);
  if (!parsed.success) return apiError(parsed.error.message, 400);

  const { description, connection_ids, api_key_id, use_platform_key } = parsed.data;
  const isRefinement = isGenesisRefinementRequest(parsed.data);
  // One-time agent generation. Mutually exclusive with refinement in practice —
  // refinement always edits an existing (workflow) program.
  const isAgent = parsed.data.program_type === "agent" && !isRefinement;
  const refinementText = parsed.data.refinement ?? null;
  const existingSchemaRaw = parsed.data.existing_schema ?? null;
  const usePlatformKey = use_platform_key === true;

  // Genesis V2 is dev-gated: introspection, patch refinement, and clarifying
  // questions only activate when a dev user opted in. Everything else is V1.
  // V2 access = dev (testing) OR the top plan(s) (entitlements.genesisV2). isDev
  // also unlocks all platform models (below), so a dev can test with a capable
  // model on the funded platform key without a personal billing tier.
  const [isDev, userTier] = await Promise.all([
    hasTechnicalAccess(userId, user.email),
    getUserTier(userId),
  ]);
  const v2Enabled =
    parsed.data.genesis_v2 === true &&
    (isDev || getEntitlements(userTier).genesisV2);
  // Make the gate decision visible in stdout so "did V2 run?" is answerable
  // without a DB round-trip. requested vs enabled distinguishes "toggle off" from
  // "toggle on but not a dev".
  serverLog({
    level: "info",
    event: "genesis.v2.gate",
    message: "Genesis V2 gate evaluated.",
    details: {
      requested: parsed.data.genesis_v2 === true,
      enabled: v2Enabled,
      is_refinement: isRefinement,
      is_agent: isAgent,
    },
  });

  if (!usePlatformKey && !api_key_id) {
    return apiError("api_key_id is required when not using the platform key", 400);
  }

  // Resolve the model to use.
  // Platform-key path: paid users may supply a `model` override; free users are
  // locked to the default. BYOK path: `model` is always required by the schema.
  let model: string;
  // Kept so the credit pre-flight below can price the chosen model. Null on the
  // BYOK path (the user's own key pays) or when the catalog was unavailable.
  let modelPricing: ModelPricing | null = null;
  if (usePlatformKey) {
    const catalog = await getOpenRouterModelCatalog();
    const requestedModel = parsed.data.model;
    if (requestedModel && requestedModel !== PLATFORM_MODEL) {
      // Validate the requested model against the user's tier — dev accounts may
      // use any catalog model (same unlock as /api/genesis/models).
      const allowed = isDev
        ? catalog
        : getAllowedPlatformModels(
            getEntitlements(userTier).genesisPlatformModelTier,
            catalog
          );
      if (!allowed.some((m) => m.id === requestedModel)) {
        return apiError(
          `Model "${requestedModel}" is not available on your current plan. Upgrade to Solo or higher to access paid models.`,
          403
        );
      }
      model = requestedModel;
    } else {
      model = PLATFORM_MODEL;
    }
    modelPricing = catalog.find((m) => m.id === model)?.pricing ?? null;
  } else {
    model = parsed.data.model ?? "claude-sonnet-4-6";
  }
  const requestedConnectionIds = uniqueRequestedConnectionIds(connection_ids);
  const startedAt = Date.now();
  // For refinements, run compliance on what the user actually typed (the edit instruction),
  // not the program name which is passed as description in that mode.
  // One reversible session per request: the model sees stable [EMAIL_1]-style
  // placeholders; streamed nodes/edges and the final schema are rehydrated.
  const piiSession = new PseudonymizationSession();
  const sanitizedDescription = piiSession.sanitizeText(isRefinement && refinementText ? refinementText : description);
  // The existing schema also goes to the model on refinements — sanitize it
  // with the same session so its PII round-trips as placeholders too.
  const sanitizedExistingSchema = existingSchemaRaw === null ? null : piiSession.sanitizeValue(existingSchemaRaw);
  const serviceClient = createServiceClient();

  // Stage 1: rate limit and workspace resolution. Refinements use the program's
  // workspace, not whichever workspace is currently active in the sidebar.
  const rateLimitPassed = await rateLimit(`genesis:${userId}`, 10, 60_000);

  if (!rateLimitPassed) return sseErrorResponse("Too many requests. Please wait a moment and try again.", "RATE_LIMITED");

  let workspaceId: string;
  if (isRefinement) {
    const access = await getProgramAccess(parsed.data.existing_program_id!, userId);
    if (!canView(access)) return sseErrorResponse("Program not found", "PROGRAM_NOT_FOUND");
    if (!canEdit(access)) return sseErrorResponse("Only program editors can refine.", "FORBIDDEN");
    workspaceId = access!.workspaceId;
  } else {
    const ws = await getActiveWorkspace(userId);
    if (!ws) return sseErrorResponse("No active workspace", "NO_WORKSPACE");
    if (!canContributeToWorkspace(ws.role)) return sseErrorResponse("Viewers cannot generate programs.", "FORBIDDEN");
    workspaceId = ws.workspaceId;

    // Agents are a Solo+ feature — block building one on the Free plan before we
    // spend a Genesis use creating something that could never run.
    if (isAgent) {
      const agentAccess = await checkAgentAccess(userId, workspaceId);
      if (!agentAccess.allowed) {
        return sseErrorResponse(
          agentAccess.upgradeMessage ?? "Agents require an upgrade.",
          "AGENTS_REQUIRE_UPGRADE"
        );
      }
    }

    // Agents act on the workspace, so creating one requires agent permission
    // here (owner always allowed; others need the workspace's external-agent
    // setting + minimum role). Fail fast rather than create an unrunnable agent.
    if (isAgent && !(await canRunAgentInWorkspace(workspaceId, userId))) {
      return sseErrorResponse(
        "You don't have permission to run agents in this workspace.",
        "AGENT_FORBIDDEN"
      );
    }
  }

  // Stage 2: genesis limit, program limit, connections, and API keys all need workspaceId — run in parallel
  const pendingConnections = requestedConnectionIds.length > 0
    ? supabase.from("connections").select("id, name, provider, scopes")
        .in("id", requestedConnectionIds).eq("workspace_id", workspaceId).eq("is_valid", true)
    : Promise.resolve({ data: [] as Array<{ id: string; name: string; provider: string; scopes: string[] | null }>, error: null });

  const pendingApiKeys = usePlatformKey
    ? Promise.resolve({ data: null as null, error: null })
    : serviceClient.from("api_keys").select("id, vault_secret_id, provider")
        .eq("workspace_id", workspaceId).eq("is_valid", true);

  const [limitCheck, connResult, keysResult, userProfileContext] = await Promise.all([
    isRefinement ? Promise.resolve({ allowed: true, upgradeMessage: null }) : checkProgramLimit(userId, workspaceId),
    pendingConnections,
    pendingApiKeys,
    // Consent-gated onboarding background (full summary with consent, anonymized
    // categories otherwise) — personalizes generated workflows/agents.
    getUserAiContext(serviceClient as unknown as { from(table: string): any }, userId).catch(() => null),
  ]);

  if (!limitCheck.allowed) return sseErrorResponse(limitCheck.upgradeMessage ?? "Program limit reached.", "PROGRAM_LIMIT_REACHED");

  // Resolve connections
  let connections: GenesisConnectionRow[] = [];
  if (requestedConnectionIds.length > 0) {
    const { data: rawConnections, error: connError } = connResult;
    if (connError) return sseErrorResponse("Could not verify selected connections.", "CONNECTION_LOOKUP_FAILED");
    connections = (rawConnections ?? []) as unknown as GenesisConnectionRow[];
    const missingConnectionIds = getMissingConnectionIds(requestedConnectionIds, connections);
    if (missingConnectionIds.length > 0) {
      return sseErrorResponse(
        "One or more selected connections are unavailable. Refresh the page and choose valid connections.",
        "CONNECTIONS_INVALID"
      );
    }
  }

  const availableConnections = toGenesisConnectionList(connections);

  // Genesis V2 (dev-gated): introspect the selected connections for live,
  // metadata-only capability data. User-named strings are registered with
  // piiSession — only placeholders reach the prompt. Failures fall back to the
  // static catalog. Skipped entirely when V2 is off.
  let capabilitySection: string | null = null;
  // Per-provider breakdown of the same introspected data, for decomposed
  // generation's Phase 2 resolve calls (each sees only its own provider's
  // capability data, same as it only sees its own operation docs) — see
  // buildCapabilitySectionsByProvider in introspection.ts.
  let capabilityByProvider: Map<string, string> | undefined;
  // Names-only view for Phase 1 (planning) — the full section's nested
  // properties (a Notion database's fields, a form's questions, etc.) are only
  // needed once Phase 2 is filling in operation_params for one specific
  // operation; including them at planning time reintroduces exactly the
  // context bloat decomposition exists to avoid. See buildCapabilityNamesSection.
  let planCapabilitySection: string | null = null;
  // Hoisted so the deterministic ambiguity-detection pass (after Phase 2, see
  // below) can compare a resolved node's target against how many real
  // candidates of that kind actually exist.
  let capabilityDescriptors: CapabilityDescriptor[] = [];
  if (v2Enabled && connections.length > 0 && !isAgent) {
    const descriptors = await fetchConnectionCapabilities(
      connections.map((row) => row.id),
      userId
    );
    capabilityDescriptors = descriptors;
    capabilitySection = buildCapabilitySection(descriptors, connections, piiSession);
    capabilityByProvider = buildCapabilitySectionsByProvider(descriptors, connections, piiSession);
    planCapabilitySection = buildCapabilityNamesSection(descriptors, connections, piiSession);
    // Confirm the capability section actually made it into the prompt (present +
    // size + resource/user-named counts), so "model ignored the channels" can be
    // told apart from "channels never reached the prompt".
    serverLog({
      level: "info",
      event: "genesis.capability_section",
      message: "Capability section built for the prompt.",
      details: {
        present: capabilitySection !== null,
        chars: capabilitySection?.length ?? 0,
        ...summarizeCapabilities(descriptors),
      },
    });
  }

  // Align user-typed references to introspected resources with the same
  // placeholders used in the capability section (identity without the name).
  // No-op when introspection didn't run (no known values registered).
  const groundedDescription = piiSession.applyKnownValues(sanitizedDescription.value);
  const groundedExistingSchema = sanitizedExistingSchema === null
    ? null
    : piiSession.applyKnownValuesToValue(sanitizedExistingSchema.value);

  const selectedProviders = availableConnections.map((conn) => conn.type);
  const providersForPrompt = selectedProviders.length > 0 ? selectedProviders : null;
  // Fresh workflow generation goes through the decomposed "plan-then-resolve"
  // path (see decomposed-generation.ts): this call gets a much smaller prompt
  // with no connector operation docs at all, and connection nodes come back
  // as an unresolved placeholder that a per-provider resolve pass fills in
  // after this call completes. Refinements (already patch-based, already
  // small) and agent generation (its own prompt/tool catalog) are unaffected.
  // Gated on v2Enabled (same gate as introspection/patches/clarifications) —
  // V1's single-shot prompt stays the default for everyone else. This is a
  // deliberate release-sequencing choice, not a technical requirement: V2 is
  // being held back for a dedicated launch moment rather than silently
  // becoming everyone's default generation behavior ahead of that.
  const isDecomposedGeneration = v2Enabled && !isAgent && !isRefinement;
  const genesisSystemPrompt = isAgent
    ? buildAgentSystemPrompt(providersForPrompt)
    : isDecomposedGeneration
      ? buildPlanSystemPrompt(providersForPrompt, null, planCapabilitySection, { allowClarifications: v2Enabled })
      : buildGenesisSystemPrompt(providersForPrompt, null, capabilitySection, {
          allowClarifications: v2Enabled && !isRefinement,
        });

  // A `genesis_uses` grant funds this generation outright; otherwise it is paid
  // for in credits. Claimed atomically so two requests can't both spend the
  // same last unit, and released below if no model call ends up being billed.
  let bonusFunded = false;
  if (usePlatformKey) {
    bonusFunded = await consumeGenesisBonus(userId, workspaceId);
  }
  // Once a model call has been billed against the claimed unit it is genuinely
  // spent, so later failures (parsing, saving) must not hand it back.
  let bonusFinalized = false;
  const settleBonus = () => { bonusFinalized = true; };
  const releaseBonus = async () => {
    if (!bonusFunded || bonusFinalized) return;
    bonusFinalized = true;
    await refundGenesisBonus(userId, workspaceId);
  };

  // ── Credit pre-flight ───────────────────────────────────────────────────────
  // Priced now that the real prompt exists, and before a single token is spent.
  // The catalog spans three orders of magnitude on output price, so charging
  // only afterwards would let one generation on an expensive model run up a
  // bill many times the caller's balance.
  if (usePlatformKey && !bonusFunded) {
    const promptTokens =
      estimateTokens(genesisSystemPrompt) +
      estimateTokens(sanitizedDescription.value) +
      (sanitizedExistingSchema ? estimateTokens(JSON.stringify(sanitizedExistingSchema.value)) : 0);
    const estimatedCredits = estimateGenesisCredits({
      pricing: modelPricing,
      promptTokens,
      maxOutputTokens: GENESIS_MAX_TOKENS,
    });

    const affordability = await checkGenesisAffordability(userId, estimatedCredits);
    if (!affordability.affordable) {
      const needed = affordability.estimatedCredits;
      return sseErrorResponse(
        needed === null
          ? "You're out of AI credits. Top up or switch to your own API key to keep using Genesis."
          : `This generation needs about ${needed.toLocaleString("en-US")} credits on ${model} and you have ${affordability.balance.toLocaleString("en-US")}. Pick a cheaper model, top up, or use your own API key.`,
        "INSUFFICIENT_CREDITS",
      );
    }
  }

  // Resolve API keys
  let keyCandidates: GenesisApiKeyRow[];

  if (usePlatformKey) {
    // Streaming builds consume the plan's Genesis-use allowance. Platform
    // credits remain metered for workflow execution and editor refinements.
    const platformRawKey = process.env.PLATFORM_OPENROUTER_API_KEY ?? "";
    if (!platformRawKey) {
      await releaseBonus();
      return sseErrorResponse("Platform AI key is not available.", "PLATFORM_KEY_UNAVAILABLE");
    }
    keyCandidates = [{ id: "platform", vault_secret_id: platformRawKey, provider: "openrouter" }];
  } else {
    const { data: allKeyRows, error: keysError } = keysResult;
    const validKeyRows = (allKeyRows ?? []) as unknown as GenesisApiKeyRow[];
    if (keysError || validKeyRows.length === 0) {
      return sseErrorResponse("API key not found. Please add a valid API key.", "API_KEY_INVALID");
    }
    keyCandidates = sortApiKeyFallbacks(api_key_id!, validKeyRows);
    if (keyCandidates.length === 0) {
      return sseErrorResponse("Selected API key not found or invalid.", "API_KEY_INVALID");
    }
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: StreamEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      const scanner = new PartialSchemaScanner();

      const pushChunk = (chunk: string) => {
        // Refinements return a PATCH, not a schema — its add.nodes fragments
        // would stream as node events and wipe the editor canvas mid-edit.
        // The canvas keeps its current state until `done` delivers the diff.
        if (isRefinement) return;
        const delta = scanner.feed(chunk);
        // Live-preview events carry model output → rehydrate placeholders so
        // the user reviews the real values, not [EMAIL_1].
        if (delta.programName) send({ type: "meta", program_name: piiSession.rehydrateText(delta.programName) });
        for (const node of delta.newNodes) send({ type: "node", node: piiSession.rehydrateValue(node) });
        for (const edge of delta.newEdges) send({ type: "edge", edge: piiSession.rehydrateValue(edge) });
      };

      let rawText = "";
      let modelUsed = model;
      // Captured on success so the post-validation repair pass (below) can
      // reuse the same key/model instead of re-running key/model fallback.
      let usedApiKey = "";
      let usedKeyRow: GenesisApiKeyRow | null = null;
      // Hoisted so the catch block can check whether an abort was compliance-triggered.
      let complianceBlockReason: string | null = null;

      try {
        // EU compliance filter runs in parallel with generation.
        // If it returns a hard "blocked" verdict, the AbortController cancels the active LLM call.
        const ac = new AbortController();
        const compliancePromise: Promise<import("@/lib/genesis/eu-compliance").EuComplianceResult | null> = (async () => {
          try {
            const filterKeyRow = pickEuComplianceFilterKey(keyCandidates);
            if (!filterKeyRow) return null;
            const filterApiKey = filterKeyRow.id === "platform"
              ? filterKeyRow.vault_secret_id
              : await vaultRetrieve(serviceClient, filterKeyRow.vault_secret_id);
            const result = await runEuComplianceFilter(groundedDescription, filterKeyRow, filterApiKey, { userId, workspaceId });
            if (result?.verdict === "blocked") {
              complianceBlockReason = result.blockedReason;
              ac.abort();
            }
            return result ?? null;
          } catch {
            return null;
          }
        })();

        send({ type: "status", message: "Contacting model..." });

        // Refinement previously sent the raw edit text + schema to the model;
        // both now go through the same pseudonymization session as generation.
        const userMessage = isRefinement && refinementText && groundedExistingSchema
          ? buildRefinementUserMessage(groundedDescription, groundedExistingSchema as object, availableConnections, null, { usePatch: v2Enabled })
          : isAgent
            ? buildAgentUserMessage(groundedDescription, availableConnections, null, userProfileContext)
            : buildGenesisUserMessage(groundedDescription, availableConnections, null, userProfileContext);

        keyAttemptLoop:
        for (let keyIndex = 0; keyIndex < keyCandidates.length; keyIndex += 1) {
          const currentKeyRow = keyCandidates[keyIndex]!;

          let currentApiKey: string;
          try {
            currentApiKey = currentKeyRow.id === "platform"
              ? currentKeyRow.vault_secret_id
              : await vaultRetrieve(serviceClient, currentKeyRow.vault_secret_id);
          } catch {
            continue;
          }

          const effectiveModel = keyIndex === 0 ? model : (KEY_DEFAULT_MODELS[currentKeyRow.provider] ?? model);
          const modelCandidates = getModelCandidates(currentKeyRow.provider, effectiveModel);

          for (let modelIndex = 0; modelIndex < modelCandidates.length; modelIndex += 1) {
            const candidateModel = modelCandidates[modelIndex] ?? model;
            rawText = "";
            let usageData: LlmUsageLike = null;

            try {
              if (currentKeyRow.provider === "anthropic") {
                const anthropic = new Anthropic({ apiKey: currentApiKey });
                const msgStream = anthropic.messages.stream({
                  model: candidateModel,
                  max_tokens: GENESIS_MAX_TOKENS,
                  temperature: GENESIS_TEMPERATURE,
                  system: genesisSystemPrompt,
                  messages: [{ role: "user", content: userMessage }],
                }, { signal: ac.signal });

                msgStream.on("text", (textDelta) => {
                  rawText += textDelta;
                  pushChunk(textDelta);
                });

                const final = await msgStream.finalMessage();
                usageData = final.usage as LlmUsageLike;
                if (!rawText && final.content[0]?.type === "text") {
                  rawText = (final.content[0] as { type: "text"; text: string }).text;
                }
              } else {
                const baseURL = getProviderBaseURL(currentKeyRow.provider);
                const openai = new OpenAI({ apiKey: currentApiKey, ...(baseURL && { baseURL }), timeout: 240_000 });
                const openaiStream = await openai.chat.completions.create({
                  model: candidateModel,
                  max_tokens: GENESIS_MAX_TOKENS,
                  stream: true,
                  ...(supportsOpenAiJsonMode(currentKeyRow.provider, baseURL) && {
                    response_format: { type: "json_object" as const },
                  }),
                  // Usage in the final stream chunk: OpenRouter reports exact
                  // billed cost with usage accounting; OpenAI needs stream_options.
                  ...(currentKeyRow.provider === "openrouter" && ({ usage: { include: true } } as object)),
                  ...(currentKeyRow.provider === "openai" && { stream_options: { include_usage: true } }),
                  messages: [
                    { role: "system", content: genesisSystemPrompt },
                    { role: "user", content: userMessage },
                  ],
                }, { signal: ac.signal });

                for await (const chunk of openaiStream) {
                  const chunkUsage = (chunk as { usage?: LlmUsageLike }).usage;
                  if (chunkUsage) usageData = chunkUsage;
                  const piece = chunk.choices[0]?.delta?.content ?? "";
                  if (piece) {
                    rawText += piece;
                    pushChunk(piece);
                  }
                }
              }

              if (!rawText) {
                if (modelIndex < modelCandidates.length - 1) {
                  const nextModel = modelCandidates[modelIndex + 1] ?? "fallback model";
                  send({ type: "status", message: `Model returned no output; trying ${nextModel}...` });
                  continue;
                }
                throw new Error("The AI did not respond. Please try again in a moment.");
              }

              modelUsed = candidateModel;
              usedApiKey = currentApiKey;
              usedKeyRow = currentKeyRow;
              await chargeGenesisUsage({
                userId,
                workspaceId,
                model: candidateModel,
                usage: usageData,
                pricing: modelPricing,
                billing: currentKeyRow.id === "platform" ? "platform" : "byok",
                bonusFunded,
              });
              settleBonus();
              serverLog({
                level: "info",
                event: "genesis.stream.model_used",
                message: "Genesis produced output.",
                details: { provider: currentKeyRow.provider, model: candidateModel, is_refinement: isRefinement },
              });
              break keyAttemptLoop;
            } catch (err) {
              // The EU compliance filter aborted this call (hard block). Stop
              // immediately with the friendly reason instead of grinding every
              // remaining model/key against an already-aborted signal — which
              // would stream misleading "trying fallback model" statuses and
              // ultimately surface the raw AbortError. The outer catch maps this
              // to EU_COMPLIANCE_BLOCKED (complianceBlockReason is set).
              if (complianceBlockReason || ac.signal.aborted) {
                throw new Error(
                  `This workflow was blocked by EU compliance: ${complianceBlockReason ?? "the request was blocked."}`
                );
              }

              // A credit/auth error means the KEY is dead — trying its other
              // models would fail identically, so don't. Skip straight to the
              // next key (or fail) instead of grinding the fallback chain.
              const keyIsDead = isKeyError(err);
              serverLog({
                level: "warn",
                event: "genesis.stream.model_attempt_failed",
                message: "A Genesis model attempt failed.",
                details: {
                  provider: currentKeyRow.provider,
                  model: candidateModel,
                  key_error: keyIsDead,
                  error: err instanceof Error ? err.message.slice(0, 160) : "unknown",
                },
              });

              const canModelFallback =
                !keyIsDead &&
                rawText.length === 0 &&
                modelIndex < modelCandidates.length - 1;

              if (canModelFallback) {
                const nextModel = modelCandidates[modelIndex + 1] ?? "fallback model";
                send({ type: "status", message: `Model unavailable; trying ${nextModel}...` });
                continue;
              }

              const nextKey = keyCandidates[keyIndex + 1];
              if (rawText.length === 0 && nextKey) {
                send({ type: "status", message: `Key failed; trying fallback key...` });
                continue keyAttemptLoop;
              }

              throw err;
            }
          }
        }

        // Emit any trailing nodes/edges the streaming pass was holding back
        if (!isRefinement) {
          const finalDelta = scanner.finalize();
          if (finalDelta.programName) send({ type: "meta", program_name: piiSession.rehydrateText(finalDelta.programName) });
          for (const node of finalDelta.newNodes) send({ type: "node", node: piiSession.rehydrateValue(node) });
          for (const edge of finalDelta.newEdges) send({ type: "edge", edge: piiSession.rehydrateValue(edge) });
        }

        if (!rawText) throw new Error("The AI did not respond. Please try again in a moment.");

        send({ type: "status", message: "Validating schema..." });

        // Detect likely token-limit truncation: the response has content but the
        // JSON object was never closed. jsonrepair will close it, but the result
        // will be a stripped-down schema that fails validation anyway — so surface
        // a more useful message immediately instead of going through that loop.
        const trimmedRaw = rawText.trimEnd();
        const looksLikeTruncation =
          trimmedRaw.length > 200 &&
          !trimmedRaw.endsWith("}") &&
          !trimmedRaw.endsWith("]") &&
          trimmedRaw.includes("{");

        // Full parse with three-layer recovery
        let parsedSchema: unknown;
        try {
          parsedSchema = JSON.parse(extractJson(rawText));
        } catch {
          try {
            parsedSchema = JSON.parse(jsonrepair(extractJson(rawText)));
          } catch {
            if (looksLikeTruncation) {
              throw new Error(
                "Your description produced a workflow too large to generate in one pass. Try breaking it into smaller steps or simplifying the description."
              );
            }
            throw new Error(
              "The AI returned a response we could not use. Try rephrasing your description and generating again."
            );
          }
        }

        // Put the real values back into the parsed schema (the model only ever
        // saw placeholders), so the saved workflow is configured with usable
        // data. Deferred for decomposed generation — Phase 2's resolve calls
        // (below) must never see real user data, and the deterministic
        // ambiguity check needs placeholders intact to match against. Those
        // paths rehydrate right before normalizeSchema instead (see below).
        // Refinement patches merge into the trusted, already-real existing
        // schema, so they still need rehydration now.
        if (!isDecomposedGeneration) {
          parsedSchema = piiSession.rehydrateValue(parsedSchema);
        }

        if (parsedSchema && typeof parsedSchema === "object" && "error" in parsedSchema) {
          const genesisError = parsedSchema as Record<string, unknown>;
          throw new Error(
            typeof genesisError.message === "string"
              ? genesisError.message
              : "Genesis model reported it could not generate this program."
          );
        }

        if (
          parsedSchema &&
          typeof parsedSchema === "object" &&
          "program_id" in parsedSchema &&
          (parsedSchema as Record<string, unknown>).program_id === "__GENERATED__"
        ) {
          (parsedSchema as Record<string, unknown>).program_id = crypto.randomUUID();
        }

        // Genesis V2 refinement: the model returns a patch, applied here to the
        // trusted existing schema. Full-schema responses (weak models ignoring
        // the patch instruction) fall through to the legacy path; the diff is
        // computed instead so the client can animate either way.
        let patchSummary: GenesisPatchSummary | null = null;
        if (v2Enabled && isRefinement && existingSchemaRaw && typeof existingSchemaRaw === "object") {
          if (isGenesisPatch(parsedSchema)) {
            const patchResult = GenesisPatchZ.safeParse(parsedSchema);
            if (!patchResult.success) {
              throw new Error("The AI returned an edit we could not apply. Please try again.");
            }
            const applied = applyGenesisPatch(existingSchemaRaw as object, patchResult.data);
            parsedSchema = applied.schema;
            patchSummary = applied.summary;
          }
        }

        // Always strip a `clarifications` sidecar before schema validation so a
        // stray key can't fail an otherwise-valid schema; only ACT on it under
        // V2 (the V1 prompt never asks for questions, so this is normally []).
        // Rehydrated independently of the schema's own (possibly still-
        // deferred, see above) rehydration — question text is user-facing and
        // must never show a raw placeholder. A no-op if parsedSchema was
        // already rehydrated by this point (nothing left to substitute).
        const extractedClarifications = !isRefinement && !isAgent
          ? (piiSession.rehydrateValue(extractClarifications(parsedSchema)) as GenesisClarification[])
          : [];
        // Mutable: the deterministic ambiguity check (after Phase 2, below)
        // appends to this when it finds a write-scoped node targeting an
        // unresolved ambiguous resource the model didn't flag itself.
        let clarifications = v2Enabled ? extractedClarifications : [];

        // Phase 2 of decomposed generation: resolve every "pending" connection
        // node the plan-mode prompt produced, one call per provider actually
        // used. Must run before normalizeSchema/normalizeProgramDraft below —
        // those rebuild connection-node config from a fixed field allowlist and
        // would otherwise strip the "pending"/"purpose" markers this depends
        // on. See decomposed-generation.ts for the merge/fallback contract.
        if (isDecomposedGeneration && usedKeyRow) {
          const pendingGroups = collectPendingConnectionGroups(parsedSchema);
          const pendingProviders = [...pendingGroups.keys()];
          const pendingNodeCount = pendingProviders.reduce((n, p) => n + (pendingGroups.get(p)?.length ?? 0), 0);

          const resolveKeyRow = usedKeyRow;
          const callResolveModel = createRepairModelCaller(
            {
              provider: resolveKeyRow.provider,
              apiKey: usedApiKey,
              model: modelUsed,
              billing: resolveKeyRow.id === "platform" ? "platform" : "byok",
              userId,
              workspaceId,
            },
            1536
          );
          const { resolvedProviders, failedProviders } = await resolvePendingConnections(
            parsedSchema,
            groundedDescription,
            (systemPrompt, userMessage) => callResolveModel(userMessage, systemPrompt),
            (provider) => send({ type: "status", message: `Resolving ${provider} integration...` }),
            capabilityByProvider
          );
          // Always logged (not just on failure) — this is the only server-side
          // evidence that Phase 2 actually ran, since a fully-successful pass
          // otherwise leaves no trace. A plan-mode call that produced zero
          // pending nodes (pending_node_count: 0) means the model either
          // ignored the "pending" connector_type instruction and emitted
          // resolved config directly in Phase 1, or the plan had no connection
          // nodes at all — worth knowing when diagnosing "did V2 even run".
          serverLog({
            level: failedProviders.length > 0 ? "warn" : "info",
            event: "genesis.stream.decomposed_resolve",
            message: "Decomposed generation Phase 2 (connector resolve) completed.",
            details: {
              pending_providers: pendingProviders.join(","),
              pending_node_count: pendingNodeCount,
              resolved_providers: resolvedProviders.join(","),
              failed_providers: failedProviders.join(","),
            },
          });

          // Deterministic ambiguity detection (no model call — see
          // ambiguity-detection.ts): catches a write-scoped node that
          // resolved against one of several real same-kind candidates
          // without the description narrowing which one, regardless of
          // whether the model itself thought to flag it. Must run here,
          // before the deferred rehydration below, while operation_params
          // still holds [CATEGORY_N] placeholders to match against. Skips a
          // node the model already flagged on its own — never double-ask.
          const ambiguousTargets = findAmbiguousTargets(parsedSchema, capabilityDescriptors).filter(
            (target) => !clarifications.some((c) => c.node_id === target.nodeId)
          );
          if (ambiguousTargets.length > 0) {
            clarifications = [
              ...clarifications,
              ...ambiguousTargets.map(buildAmbiguityClarification),
            ].slice(0, MAX_CLARIFICATIONS);
            serverLog({
              level: "info",
              event: "genesis.stream.deterministic_clarification",
              message: "Deterministic ambiguity check flagged one or more unresolved write-target choices.",
              details: {
                node_ids: ambiguousTargets.map((t) => t.nodeId).join(","),
                categories: ambiguousTargets.map((t) => t.category).join(","),
              },
            });
          }
        }

        // Rehydrate now if deferred above (decomposed generation only) — Phase
        // 2 and the ambiguity check above are done with the schema, so real
        // values can safely be substituted back in before validation/save.
        if (isDecomposedGeneration) {
          parsedSchema = piiSession.rehydrateValue(parsedSchema);
        }

        // Stamp the agent discriminator BEFORE normalizeSchema: its corelyx
        // connection-node repair (a bogus "corelyx:primary" connection rewritten
        // into a report_to_user agent_task) only fires when program_type ===
        // "agent". The model often omits program_type, so without setting it
        // first the repair was skipped and the broken connection ref reached the
        // runtime, failing every agent run with "corelyx is not a connectable app".
        if (isAgent) (parsedSchema as { program_type?: string }).program_type = "agent";
        normalizeSchema(parsedSchema);
        parsedSchema = normalizeProgramDraft(
          parsedSchema,
          isRefinement && existingSchemaRaw && typeof existingSchemaRaw === "object"
            ? (existingSchemaRaw as Partial<ProgramSchema>)
            : undefined
        );
        // Re-assert after normalizeProgramDraft in case the draft merge dropped
        // it: agent programs use agent_task nodes, which ProgramDraftSchemaZ only
        // permits when program_type === "agent".
        if (isAgent) (parsedSchema as { program_type?: string }).program_type = "agent";
        // The model occasionally emits an edge to a node it renamed or never
        // produced. A single dangling reference would otherwise fail the whole
        // draft and force the user to "rephrase" an almost-valid plan. Prune
        // those before validating — the user reviews the plan before it runs.
        const pruned = pruneUnresolvedReferences(parsedSchema as ProgramSchema);
        if (pruned.removedEdges > 0 || pruned.removedTriggers > 0) {
          await writeAppLog(supabase, {
            userId,
            level: "info",
            source: "Genesis",
            event: "genesis.stream.pruned_unresolved_references",
            status: "completed",
            message: "Removed edges/triggers referencing missing nodes from generated draft.",
            durationMs: Date.now() - startedAt,
            details: {
              requested_model: model,
              model_used: modelUsed,
              removed_edges: pruned.removedEdges,
              removed_triggers: pruned.removedTriggers,
            },
          });
        }
        // Fill "__USER_ASSIGNED__" agent model/key sentinels with a usable
        // workspace key so generated agent nodes don't fail pre-flight.
        {
          let assignableKeys: Array<{ id: string; provider: string }> =
            keyCandidates.filter((k) => k.id !== "platform");
          if (assignableKeys.length === 0) {
            const { data: workspaceKeys } = await serviceClient
              .from("api_keys")
              .select("id, provider")
              .eq("workspace_id", workspaceId)
              .eq("is_valid", true);
            assignableKeys = (workspaceKeys ?? []) as Array<{ id: string; provider: string }>;
          }
          assignAgentNodeDefaults(parsedSchema, assignableKeys);
        }

        const draftResult = validateProgramDraft(parsedSchema);
        if (!draftResult.success) {
          // Log the technical details server-side; send a user-friendly message downstream.
          await writeAppLog(supabase, {
            userId,
            level: "warning",
            source: "Genesis",
            event: "genesis.stream.draft_validation_failed",
            status: "failed",
            message: "Draft validation failed after streaming generation.",
            durationMs: Date.now() - startedAt,
            details: {
              requested_model: model,
              model_used: modelUsed,
              validation_errors: draftResult.error.flatten(),
            },
          });
          const hint = looksLikeTruncation
            ? "Try a simpler description — the workflow may have been too large to generate in one pass."
            : "Try rephrasing your description to be more specific about the steps involved.";
          throw new Error(`The AI generated a workflow we could not validate. ${hint}`);
        }
        const schemaResult = ProgramSchemaZ.safeParse(parsedSchema);
        const schema = schemaResult.success ? schemaResult.data : draftResult.data;
        // Keep the stored schema's discriminator aligned with the column even if
        // the model forgot to emit program_type.
        if (isAgent) (schema as { program_type?: string }).program_type = "agent";
        // metadata.genesis_model is whatever the model itself wrote into that
        // field per the prompt's TOP-LEVEL SCHEMA example — unverified model
        // output, not a fact (a weak model may echo the literal placeholder or
        // guess wrong). Overwrite with the model that actually produced this
        // schema so downstream consumers can trust it — e.g. the clarifying-
        // question answer route reuses it instead of falling back to a fixed
        // default model regardless of what generated the program.
        (schema as { metadata: { genesis_model: string } }).metadata.genesis_model = modelUsed;
        // Same reasoning for the timestamp: the model cannot know the current
        // date and hallucinates one (seen: a saved 2025 date on a 2026 program).
        (schema as { metadata: { genesis_timestamp?: string } }).metadata.genesis_timestamp =
          new Date().toISOString();
        let validation = validatePostGenesis(schema as unknown as Parameters<typeof validatePostGenesis>[0], connections);

        // Targeted repair pass — see semantic-repair.ts. Deterministic fixes
        // first (free), then one narrow single-node model call per node still
        // missing required operation params, reusing the key/model that
        // already succeeded above. Best-effort: never worse than leaving the
        // original warning if a repair call fails.
        {
          const typedSchema = schema as unknown as ProgramSchema;
          const detRepair = applyDeterministicRepairs(typedSchema, validation);
          let needsRevalidate = detRepair.fixedNodeIds.length > 0;

          if (validation.warnings.some((w) => w.code === "WARN_004") && usedKeyRow) {
            const callGenesisRepairModel = createRepairModelCaller({
              provider: usedKeyRow.provider,
              apiKey: usedApiKey,
              model: modelUsed,
              billing: usedKeyRow.id === "platform" ? "platform" : "byok",
              userId,
              workspaceId,
            });
            const { repairedNodeIds } = await repairMissingOperationParams(
              typedSchema,
              connections,
              groundedDescription,
              callGenesisRepairModel
            );
            if (repairedNodeIds.length > 0) needsRevalidate = true;
          }

          if (needsRevalidate) {
            validation = validatePostGenesis(schema as unknown as Parameters<typeof validatePostGenesis>[0], connections);
          }
        }

        // Await compliance before saving — catches late-arriving blocks if generation
        // finished faster than the compliance model responded.
        const complianceResult = await compliancePromise;
        if (complianceBlockReason) {
          throw new Error(`This workflow was blocked by EU compliance: ${complianceBlockReason}`);
        }

        const complianceObligations = complianceResult?.verdict === "obligations" ? complianceResult.context : null;

        if (isRefinement) {
          // Under V2, if the model returned a full schema instead of a patch,
          // derive the diff so the editor still animates the change. Under V1
          // no patch is sent and the editor does its normal silent swap.
          if (v2Enabled && !patchSummary && existingSchemaRaw && typeof existingSchemaRaw === "object") {
            patchSummary = diffSchemas(existingSchemaRaw as object, schema as object);
          }

          // Refinement (AI edit): return the updated schema to the client.
          // The editor applies it via RESTORE_VERSION and handles its own save.
          send({
            type: "done",
            program_id: parsed.data.existing_program_id ?? "",
            program_name: schema.program_name,
            validation,
            schema,
            patch: patchSummary,
          });

          await Promise.all([
            writeAppLog(supabase, {
              userId,
              level: "info",
              source: "Genesis",
              event: "genesis.stream.refinement.completed",
              status: "completed",
              message: `AI edit applied to "${schema.program_name}".`,
              durationMs: Date.now() - startedAt,
              details: {
                requested_model: model,
                model_used: modelUsed,
                node_count: schema.nodes.length,
                edge_count: schema.edges.length,
                validation_errors: validation.errors.length,
                validation_warnings: validation.warnings.length,
              },
            }),
            recordGenesisUse(userId, workspaceId),
          ]);
        } else {
          send({ type: "status", message: "Saving program..." });

          // The model is unreliable at computing node coordinates, so it tends to
          // emit a straight line. Lay the graph out deterministically (branches and
          // all) before persisting, using the caller's preferred orientation.
          const layoutDirection = parsed.data.layout_direction ?? DEFAULT_LAYOUT_DIRECTION;
          const savedSchema = {
            ...schema,
            nodes: layoutSchema(schema.nodes, schema.edges, layoutDirection),
          };

          const { data: rawProgram, error: insertError } = await serviceClient
            .from("programs")
            .insert({
              user_id: userId,
              workspace_id: workspaceId,
              name: savedSchema.program_name,
              description,
              schema: savedSchema as unknown as Record<string, unknown>,
              execution_mode: mapExecutionMode(savedSchema.execution_mode),
              ...(complianceObligations ? { ai_act_notes: complianceObligations } : {}),
              // One-time agents are created paused, awaiting the user's approval
              // of the plan before they may run.
              ...(isAgent
                ? { program_type: "agent", agent_state: "awaiting_approval" }
                : {}),
            } as unknown as never)
            .select("id, name")
            .single();

          const program = rawProgram as unknown as { id: string; name: string } | null;

          if (insertError || !program) {
            throw new Error("The workflow was generated but could not be saved. Please try again.");
          }

          const postSaveResults = await Promise.all([
            serviceClient.from("program_memberships").insert({
              program_id: program.id,
              user_id: userId,
              role: "editor",
              created_by: userId,
            } as unknown as never),
            connections.length > 0
              ? serviceClient.from("program_connections").insert(
                  toProgramConnectionLinks(program.id, connections) as unknown as never
                )
              : Promise.resolve({ error: null }),
            serviceClient.from("program_versions").insert({
              program_id: program.id,
              version: 0,
              schema: savedSchema as unknown as Record<string, unknown>,
              change_summary: "Genesis — AI-generated from description",
            } as unknown as never),
          ]);

          if (connections.length > 0 && postSaveResults[1].error) {
            throw new Error("The workflow was saved but we could not link your connections to it. You can add them manually in the editor.");
          }

          // Reconcile schema trigger nodes into the `triggers` table — the cron
          // runner only fires triggers that exist as rows there. Genesis used to
          // save the program without this sync, so cron triggers looked "Active"
          // (the editor reads the schema) but never fired in production.
          try {
            await syncEventTriggers(serviceClient, program.id, savedSchema);
            await syncCronTriggers(serviceClient, program.id, savedSchema);
            await syncWebhookTriggers(serviceClient, program.id, savedSchema);
            await syncFileWatchTriggers(serviceClient, program.id, savedSchema);
          } catch (syncError) {
            await writeAppLog(supabase, {
              userId,
              level: "error",
              source: "Genesis",
              event: "genesis.stream.trigger_sync_failed",
              status: "failed",
              message: "Failed to sync schema triggers after streaming generation.",
              programId: program.id,
              details: { error: syncError instanceof Error ? syncError.message : String(syncError) },
            });
          }

          // Genesis V2: questions never block the build — the program is saved
          // complete above; the session just records what is worth confirming.
          // A failed session insert degrades to a normal no-questions build.
          let sessionId: string | null = null;
          if (clarifications.length > 0) {
            const { data: sessionRow, error: sessionError } = await serviceClient
              .from("genesis_sessions")
              .insert({
                user_id: userId,
                workspace_id: workspaceId,
                program_id: program.id,
                clarifications: clarifications as unknown as Record<string, unknown>[],
              } as unknown as never)
              .select("id")
              .single();
            if (!sessionError && sessionRow) {
              sessionId = (sessionRow as unknown as { id: string }).id;
              send({ type: "question", session_id: sessionId, clarifications });
            }
          }

          send({
            type: "done",
            program_id: program.id,
            program_name: schema.program_name,
            validation,
            ...(sessionId ? { session_id: sessionId, clarifications } : {}),
          });

          await Promise.all([
            writeAppLog(supabase, {
              userId,
              level: "info",
              source: "Genesis",
              event: "genesis.stream.completed",
              status: "completed",
              message: `Generated program "${schema.program_name}" via streaming.`,
              programId: program.id,
              durationMs: Date.now() - startedAt,
              details: {
                requested_model: model,
                model_used: modelUsed,
                node_count: schema.nodes.length,
                edge_count: schema.edges.length,
                validation_errors: validation.errors.length,
                validation_warnings: validation.warnings.length,
                pii_redacted: sanitizedDescription.redacted,
                pii_redactions: sanitizedDescription.redactions,
              },
            }),
            recordGenesisUse(userId, workspaceId),
          ]);
        }
      } catch (err) {
        await releaseBonus();
        const message = err instanceof Error ? err.message : String(err);
        if (complianceBlockReason) {
          send({ type: "error", message, code: "EU_COMPLIANCE_BLOCKED" });
        } else {
          await writeAppLog(supabase, {
            userId,
            level: "error",
            source: "Genesis",
            event: "genesis.stream.failed",
            status: "failed",
            message,
            durationMs: Date.now() - startedAt,
            details: {
              requested_model: model,
              model_used: modelUsed,
              description: truncateForLog(sanitizedDescription.value, 1000),
              raw_preview: truncateForLog(piiSession.sanitizeText(rawText).value, 2000),
              pii_redacted: hasPiiRedactions(sanitizedDescription.redactions),
              pii_redactions: sanitizedDescription.redactions,
            },
          });
          // A stale/removed model slug returns "404 No endpoints found" and a
          // busy free tier returns rate-limit/overloaded errors. Surface an
          // actionable message instead of the raw provider 404 — the technical
          // detail is preserved in the app log above.
          const userMessage =
            !isKeyError(err) && isRetryableModelError(err)
              ? usePlatformKey
                ? "The AI model is temporarily unavailable or busy. Please try again in a moment, or pick a different model."
                : "The selected AI model is temporarily unavailable or busy. Please try again, or choose a different model in API Keys."
              : message;
          send({ type: "error", message: userMessage });
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

function sseErrorResponse(message: string, code: string) {
  const encoder = new TextEncoder();
  const event: StreamEvent = { type: "error", message, code };
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      controller.close();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}
