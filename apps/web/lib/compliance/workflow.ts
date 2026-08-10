import type {
  AgentNode,
  ConnectionNode,
  ProgramSchema,
  TriggerNode,
} from "@flowos/schema";
import {
  getProviderOrUnknown,
  isProviderAllowedInEuOnly,
  providerLeavesEea,
  type Provider,
} from "@/lib/compliance/provider-registry";

export const WORKSPACE_COMPLIANCE_MODES = ["standard", "eu_only"] as const;
export type WorkspaceComplianceMode = (typeof WORKSPACE_COMPLIANCE_MODES)[number];

export type WorkspaceRetentionSettings = {
  execution_log_retention_days: number;
  prompt_retention_days: number;
  output_retention_days: number;
  approval_record_retention_days: number;
  secret_rotation_reminder_days: number;
  store_full_prompts: boolean;
  store_full_outputs: boolean;
  data_region: string;
};

export type WorkspaceComplianceSettings = WorkspaceRetentionSettings & {
  compliance_mode: WorkspaceComplianceMode;
  /** Provider IDs the workspace owner has acknowledged DPA compliance for. */
  dpa_acknowledged_providers: string[];
};

export const DEFAULT_WORKSPACE_COMPLIANCE: WorkspaceComplianceSettings = {
  compliance_mode: "standard",
  dpa_acknowledged_providers: [],
  execution_log_retention_days: 90,
  prompt_retention_days: 0,
  output_retention_days: 0,
  approval_record_retention_days: 365,
  secret_rotation_reminder_days: 90,
  store_full_prompts: false,
  store_full_outputs: false,
  data_region: "eu-central-1",
};

export const AI_ACT_RISK_LEVELS = [
  "prohibited",
  "high_risk",
  "transparency",
  "gpai_related",
  "limited_or_minimal",
  "unknown",
] as const;

export type AiActRiskLevel = (typeof AI_ACT_RISK_LEVELS)[number];

export const CUSTOMER_ROLES = [
  "provider",
  "deployer",
  "distributor",
  "importer",
  "product_manufacturer",
  "unknown",
] as const;

export type CustomerRole = (typeof CUSTOMER_ROLES)[number];

export type AiGovernanceFields = {
  ai_use_case_category: string | null;
  ai_act_risk_level: AiActRiskLevel;
  customer_role: CustomerRole;
  human_oversight_required: boolean;
  transparency_notice_required: boolean;
  high_risk_documentation_required: boolean;
  prohibited_reason: string | null;
  reviewer: string | null;
  reviewed_at: string | null;
  notes: string | null;
  legal_review_override: boolean;
};

export const DEFAULT_AI_GOVERNANCE: AiGovernanceFields = {
  ai_use_case_category: null,
  ai_act_risk_level: "unknown",
  customer_role: "unknown",
  human_oversight_required: false,
  transparency_notice_required: false,
  high_risk_documentation_required: false,
  prohibited_reason: null,
  reviewer: null,
  reviewed_at: null,
  notes: null,
  legal_review_override: false,
};

export const AI_ACT_NOTICE_TEXT =
  "You are interacting with an AI-assisted system. Outputs may be inaccurate and may be reviewed by authorised staff.";

export const HIGH_IMPACT_USE_CASES = [
  "Employment/recruitment",
  "Education assessment",
  "Creditworthiness",
  "Insurance eligibility/pricing",
  "Essential public/private services",
  "Law enforcement",
  "Migration/asylum/border control",
  "Biometric identification/categorisation",
  "Medical or safety-critical use",
  "Legal decision support",
] as const;

export type ComplianceCheckStatus = "passed" | "warning" | "blocked" | "needs_reviewer";

export type ComplianceCheck = {
  id: string;
  label: string;
  status: ComplianceCheckStatus;
  message: string;
  node_id?: string | null;
  provider_id?: string | null;
  details?: Record<string, unknown>;
};

export type DataFlowPreviewItem = {
  node_id: string;
  node_label: string;
  node_type: string;
  action: string;
  provider: Provider;
  region: string;
  data_categories: string[];
  personal_data_may_be_processed: boolean;
  leaves_eea: boolean;
  transfer_basis: string;
  retention: string;
  human_approval_gate: boolean;
  ai_model_call: boolean;
  model_name: string | null;
  logging_behavior: string;
  labels: string[];
};

export type ComplianceExportReport = {
  report_type: "corelyx.workflow_compliance_export";
  generated_at: string;
  workflow: {
    id: string;
    name: string;
    version: number | null;
    last_reviewed_at: string | null;
  };
  workspace: WorkspaceComplianceSettings;
  ai_governance: AiGovernanceFields;
  data_categories: string[];
  providers_and_subprocessors: Array<{
    id: string;
    name: string;
    category: string;
    purpose: string;
    region: string;
    transfer_basis: string;
    dpa_available: boolean;
    scc_available: boolean;
    subprocessor_url: string;
    privacy_url: string;
    retention_notes: string;
    status: string;
  }>;
  data_flow: DataFlowPreviewItem[];
  model_providers: Array<{
    provider_id: string;
    provider_name: string;
    model_name: string;
    stores_prompts: boolean;
    stores_outputs: boolean;
    trains_on_customer_data: boolean | "unknown";
  }>;
  logging: {
    prompt_input_output_logging: string;
    prompt_retention_days: number;
    output_retention_days: number;
    audit_log_fields: string[];
  };
  human_approval_gates: Array<{
    node_id: string;
    node_label: string;
    reason: string;
  }>;
  checks: ComplianceCheck[];
  risk_classification_notes: string | null;
  dpia_notes: string;
};

export type WorkflowProviderContext = {
  connections?: Array<{ id?: string; name: string; provider: string; is_valid?: boolean }>;
  apiKeys?: Array<{ id: string; name?: string; provider: string; is_valid?: boolean }>;
};

type ProgramRowLike = {
  id?: string;
  name?: string | null;
  schema_version?: number | null;
  ai_use_case_category?: string | null;
  ai_act_risk_level?: AiActRiskLevel | null;
  customer_role?: CustomerRole | null;
  human_oversight_required?: boolean | null;
  transparency_notice_required?: boolean | null;
  high_risk_documentation_required?: boolean | null;
  prohibited_reason?: string | null;
  reviewer?: string | null;
  reviewed_at?: string | null;
  ai_act_notes?: string | null;
  legal_review_override?: boolean | null;
};

function metadataRecord(schema: ProgramSchema): Record<string, unknown> {
  return schema.metadata as unknown as Record<string, unknown>;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function normaliseRiskLevel(value: unknown): AiActRiskLevel {
  return AI_ACT_RISK_LEVELS.includes(value as AiActRiskLevel)
    ? (value as AiActRiskLevel)
    : "unknown";
}

function normaliseCustomerRole(value: unknown): CustomerRole {
  return CUSTOMER_ROLES.includes(value as CustomerRole)
    ? (value as CustomerRole)
    : "unknown";
}

export function getAiGovernanceFields(
  schema: ProgramSchema,
  program?: ProgramRowLike | null
): AiGovernanceFields {
  const meta = metadataRecord(schema);
  return {
    ai_use_case_category:
      program?.ai_use_case_category ??
      readString(meta.ai_use_case_category) ??
      DEFAULT_AI_GOVERNANCE.ai_use_case_category,
    ai_act_risk_level: normaliseRiskLevel(
      program?.ai_act_risk_level ?? meta.ai_act_risk_level
    ),
    customer_role: normaliseCustomerRole(program?.customer_role ?? meta.customer_role),
    human_oversight_required: readBoolean(
      program?.human_oversight_required ?? meta.human_oversight_required,
      false
    ),
    transparency_notice_required: readBoolean(
      program?.transparency_notice_required ?? meta.transparency_notice_required,
      false
    ),
    high_risk_documentation_required: readBoolean(
      program?.high_risk_documentation_required ??
        meta.high_risk_documentation_required,
      false
    ),
    prohibited_reason:
      program?.prohibited_reason ??
      readString(meta.prohibited_reason) ??
      DEFAULT_AI_GOVERNANCE.prohibited_reason,
    reviewer:
      program?.reviewer ??
      readString(meta.reviewer) ??
      DEFAULT_AI_GOVERNANCE.reviewer,
    reviewed_at:
      program?.reviewed_at ??
      readString(meta.reviewed_at) ??
      DEFAULT_AI_GOVERNANCE.reviewed_at,
    notes:
      program?.ai_act_notes ??
      readString(meta.ai_act_notes) ??
      readString(meta.notes) ??
      DEFAULT_AI_GOVERNANCE.notes,
    legal_review_override: readBoolean(
      program?.legal_review_override ?? meta.legal_review_override,
      false
    ),
  };
}

export function mergeWorkspaceComplianceSettings(
  raw?: Partial<WorkspaceComplianceSettings> | null
): WorkspaceComplianceSettings {
  const mode = raw?.compliance_mode === "eu_only" ? "eu_only" : "standard";
  const acknowledged = Array.isArray(raw?.dpa_acknowledged_providers)
    ? (raw.dpa_acknowledged_providers as string[])
    : [];
  return {
    ...DEFAULT_WORKSPACE_COMPLIANCE,
    ...raw,
    compliance_mode: mode,
    dpa_acknowledged_providers: acknowledged,
    execution_log_retention_days: positiveInteger(
      raw?.execution_log_retention_days,
      DEFAULT_WORKSPACE_COMPLIANCE.execution_log_retention_days
    ),
    prompt_retention_days: nonNegativeInteger(
      raw?.prompt_retention_days,
      DEFAULT_WORKSPACE_COMPLIANCE.prompt_retention_days
    ),
    output_retention_days: nonNegativeInteger(
      raw?.output_retention_days,
      DEFAULT_WORKSPACE_COMPLIANCE.output_retention_days
    ),
    approval_record_retention_days: positiveInteger(
      raw?.approval_record_retention_days,
      DEFAULT_WORKSPACE_COMPLIANCE.approval_record_retention_days
    ),
    secret_rotation_reminder_days: positiveInteger(
      raw?.secret_rotation_reminder_days,
      DEFAULT_WORKSPACE_COMPLIANCE.secret_rotation_reminder_days
    ),
    store_full_prompts: raw?.store_full_prompts === true,
    store_full_outputs: raw?.store_full_outputs === true,
    data_region: raw?.data_region || DEFAULT_WORKSPACE_COMPLIANCE.data_region,
  };
}

function positiveInteger(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function nonNegativeInteger(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function connectionProviderForNode(
  node: ConnectionNode,
  context: WorkflowProviderContext
) {
  if (node.config.connector_type === "http") return "generic_http";
  // Local file ops run on the user's device — a distinct processing context with
  // no external provider (data never leaves the machine).
  if (node.config.connector_type === "file") return "local_file";
  if (node.config.provider) return node.config.provider;
  const byName = context.connections?.find((connection) => connection.name === node.connection);
  return byName?.provider ?? node.connection ?? "unknown";
}

function apiKeyProviderForAgent(node: AgentNode, context: WorkflowProviderContext) {
  const ref = node.config.api_key_ref;
  const model = node.config.model.toLowerCase();

  // Platform key: resolve from model name so compliance checks reflect the
  // actual LLM provider (e.g. claude → anthropic) rather than a fixed guess.
  if (ref !== "platform") {
    const byId = context.apiKeys?.find((key) => key.id === ref);
    if (byId?.provider) return byId.provider;
  }

  if (model.includes("claude")) return "anthropic";
  if (model.includes("gpt") || model.includes("o3") || model.includes("o4")) return "openai";
  if (model.includes("gemini")) return "google";
  if (model.includes("/")) return "openrouter";

  // Platform key with unrecognised model — treat as Corelyx internal (DPA covered).
  if (ref === "platform") return "corelyx";
  return "unknown";
}

function providerForTrigger(node: TriggerNode) {
  if (node.config.trigger_type === "event") return node.config.source;
  if (node.config.trigger_type === "webhook") return "generic_http";
  return "corelyx";
}

function providerForNode(
  node: ProgramSchema["nodes"][number],
  context: WorkflowProviderContext
) {
  if (node.type === "agent") return apiKeyProviderForAgent(node, context);
  if (node.type === "connection") return connectionProviderForNode(node, context);
  if (node.type === "trigger") return providerForTrigger(node);
  return "corelyx";
}

function nodeAction(node: ProgramSchema["nodes"][number]) {
  if (node.type === "agent") return `Model call: ${node.config.model}`;
  if (node.type === "connection") {
    if (node.config.connector_type === "http") return `${node.config.method} ${node.config.url}`;
    return node.config.operation ? `Connector operation: ${node.config.operation}` : "Connector token lookup";
  }
  if (node.type === "trigger") return `Trigger: ${node.config.trigger_type}`;
  if (node.type === "step") return `Step: ${node.config.logic_type}`;
  return node.type;
}

function nodeRequiresApproval(node: ProgramSchema["nodes"][number], schema: ProgramSchema) {
  const executionMode = schema.execution_mode as string;
  if (executionMode === "supervised" || executionMode === "approval_required") {
    return node.type === "agent";
  }
  if (executionMode === "manual") return node.type !== "trigger";
  return node.type === "agent" && node.config.requires_approval;
}

function isHighImpactAction(node: ProgramSchema["nodes"][number]) {
  if (node.type === "agent") return true;
  if (node.type !== "connection") return false;
  if (node.config.connector_type === "http") {
    return ["POST", "PUT", "PATCH", "DELETE"].includes(node.config.method);
  }
  const operation = (node.config.operation ?? "").toLowerCase();
  return [
    "send",
    "update",
    "create",
    "delete",
    "publish",
    "post",
    "write",
    "ticket",
    "crm",
    "webhook",
    "email",
  ].some((marker) => operation.includes(marker));
}

function hasAnyHumanApprovalGate(schema: ProgramSchema) {
  const executionMode = schema.execution_mode as string;
  if (executionMode === "supervised" || executionMode === "manual") return true;
  return schema.nodes.some(
    (node) => node.type === "agent" && node.config.requires_approval
  );
}

function providerLabels(provider: Provider, workspace: WorkspaceComplianceSettings) {
  const labels: string[] = [];
  if (isProviderAllowedInEuOnly(provider)) labels.push("EU-approved");
  if (provider.status === "customer_configured") labels.push("Customer-configured");
  if (providerLeavesEea(provider)) labels.push("Possible third-country transfer");
  if (workspace.compliance_mode === "eu_only" && !isProviderAllowedInEuOnly(provider)) {
    labels.push("Blocked in EU-only mode");
  }
  if (!provider.dpa_available) labels.push("DPA missing");
  if (providerLeavesEea(provider) && !provider.scc_available) labels.push("SCC required");
  labels.push(
    `Model training: ${
      provider.trains_on_customer_data === true
        ? "yes"
        : provider.trains_on_customer_data === false
          ? "no"
          : "unknown"
    }`
  );
  return labels;
}

export function buildDataFlowPreview(
  schema: ProgramSchema,
  workspace: WorkspaceComplianceSettings = DEFAULT_WORKSPACE_COMPLIANCE,
  context: WorkflowProviderContext = {}
): DataFlowPreviewItem[] {
  return schema.nodes
    .filter((node) => node.type !== "note" && node.type !== "group")
    .map((node) => {
      const providerId = providerForNode(node, context);
      const provider =
        providerId === "corelyx"
          ? getCorelyxProvider(workspace)
          : getProviderOrUnknown(providerId);
      const isModel = node.type === "agent";
      return {
        node_id: node.id,
        node_label: node.label,
        node_type: node.type,
        action: nodeAction(node),
        provider,
        region: provider.default_region,
        data_categories: provider.data_categories_processed,
        personal_data_may_be_processed: provider.personal_data_allowed,
        leaves_eea: providerLeavesEea(provider),
        transfer_basis: provider.transfer_basis,
        retention: provider.retention_notes,
        human_approval_gate: nodeRequiresApproval(node, schema),
        ai_model_call: isModel,
        model_name: isModel ? node.config.model : null,
        logging_behavior: workspace.store_full_prompts || workspace.store_full_outputs
          ? "Workspace allows full prompt/output logging where enabled; secrets are still redacted."
          : "Hashes and minimal execution metadata by default; full prompts/outputs are not stored by default.",
        labels: providerLabels(provider, workspace),
      };
    });
}

function getCorelyxProvider(workspace: WorkspaceComplianceSettings): Provider {
  return {
    id: "corelyx",
    name: "Corelyx internal runtime",
    category: "orchestration",
    purpose: "Internal workflow graph execution and policy checks.",
    default_region: workspace.data_region,
    available_regions: [workspace.data_region],
    eu_only_supported: true,
    data_categories_processed: ["Workflow metadata", "Execution metadata", "Policy-check metadata"],
    personal_data_allowed: false,
    stores_prompts: false,
    stores_outputs: false,
    trains_on_customer_data: false,
    dpa_available: true,
    scc_available: true,
    transfer_basis: "Internal processing under the Corelyx customer agreement and DPA.",
    subprocessor_url: "/subprocessors",
    privacy_url: "/privacy",
    retention_notes: "Controlled by workspace retention settings.",
    last_reviewed_at: "2026-05-27",
    status: "approved",
    optional: false,
    used_by_default: true,
    activation: "Always",
  };
}

function checkStatusFromChildren(checks: ComplianceCheck[]): ComplianceCheckStatus {
  if (checks.some((check) => check.status === "blocked")) return "blocked";
  if (checks.some((check) => check.status === "needs_reviewer")) return "needs_reviewer";
  if (checks.some((check) => check.status === "warning")) return "warning";
  return "passed";
}

function addCheck(checks: ComplianceCheck[], check: ComplianceCheck) {
  checks.push(check);
}

export function validateWorkflowCompliance(
  schema: ProgramSchema,
  workspace: WorkspaceComplianceSettings = DEFAULT_WORKSPACE_COMPLIANCE,
  context: WorkflowProviderContext = {},
  program?: ProgramRowLike | null
): ComplianceCheck[] {
  const checks: ComplianceCheck[] = [];
  const flow = buildDataFlowPreview(schema, workspace, context);
  const ai = getAiGovernanceFields(schema, program);

  const providerIssues: ComplianceCheck[] = [];
  for (const item of flow) {
    if (item.provider.id === "corelyx") continue;

    if (item.leaves_eea) {
      addCheck(providerIssues, {
        id: `gdpr-transfer-${item.node_id}`,
        label: "GDPR transfer-risk check",
        status: "warning",
        message: `${item.node_label} may involve a third-country transfer through ${item.provider.name}.`,
        node_id: item.node_id,
        provider_id: item.provider.id,
      });
    }

    // DPA/SCC gaps are only surfaced in eu_only mode where the workspace has
    // explicitly opted into strict enforcement. In standard mode these checks
    // are skipped entirely — users are responsible for their own provider DPAs
    // and there is no legal requirement to enforce this at the platform level.
    if (workspace.compliance_mode === "eu_only") {
      if (!item.provider.dpa_available) {
        addCheck(providerIssues, {
          id: `dpa-${item.node_id}`,
          label: "DPA/subprocessor completeness check",
          status: "blocked",
          message: `${item.provider.name} does not have a completed DPA entry in the Corelyx provider registry.`,
          node_id: item.node_id,
          provider_id: item.provider.id,
        });
      }

      if (providerLeavesEea(item.provider) && !item.provider.scc_available) {
        addCheck(providerIssues, {
          id: `scc-${item.node_id}`,
          label: "DPA/subprocessor completeness check",
          status: "blocked",
          message: `${item.provider.name} has no documented SCC or transfer-basis entry in the Corelyx provider registry.`,
          node_id: item.node_id,
          provider_id: item.provider.id,
        });
      }
    }

    if (workspace.compliance_mode === "eu_only" && !isProviderAllowedInEuOnly(item.provider)) {
      addCheck(providerIssues, {
        id: `eu-only-${item.node_id}`,
        label: "EU-only mode check",
        status: "blocked",
        message: `${item.provider.name} is blocked in EU-only mode until EU residency, DPA, SCCs, and transfer basis are verified.`,
        node_id: item.node_id,
        provider_id: item.provider.id,
      });
    }
  }

  addCheck(checks, {
    id: "gdpr-transfer-risk",
    label: "GDPR transfer-risk check",
    status: checkStatusFromChildren(providerIssues.filter((check) => check.id.startsWith("gdpr-transfer"))),
    message: providerIssues.some((check) => check.id.startsWith("gdpr-transfer"))
      ? "One or more providers may process data outside the EEA."
      : "No obvious third-country transfer risk was found in the reviewed workflow graph.",
  });

  const dpaIssues = providerIssues.filter(
    (check) => check.id.startsWith("dpa-") || check.id.startsWith("scc-")
  );
  const dpaProviderNames = [...new Set(
    dpaIssues.map((c) => flow.find((f) => f.node_id === c.node_id)?.provider.name).filter(Boolean)
  )] as string[];
  addCheck(checks, {
    id: "dpa-subprocessors",
    label: "DPA/subprocessor completeness check",
    status: checkStatusFromChildren(dpaIssues),
    message: dpaIssues.length > 0
      ? `${dpaProviderNames.length > 0 ? dpaProviderNames.join(", ") : "One or more providers"} ${dpaProviderNames.length === 1 ? "is" : "are"} missing DPA/SCC/transfer-basis evidence.`
      : "Reviewed providers have documented DPA and transfer-basis entries.",
    details: { provider_names: dpaProviderNames },
  });

  const euOnlyIssues = providerIssues.filter((check) => check.id.startsWith("eu-only-"));
  addCheck(checks, {
    id: "eu-only-mode",
    label: "EU-only mode check",
    status: workspace.compliance_mode === "eu_only"
      ? checkStatusFromChildren(euOnlyIssues)
      : "passed",
    message: workspace.compliance_mode === "eu_only"
      ? euOnlyIssues.length > 0
        ? "EU-only mode blocks one or more providers in this workflow."
        : "All reviewed providers pass the EU-only mode registry check."
      : "Workspace is in standard mode.",
  });

  if (ai.ai_act_risk_level === "prohibited") {
    addCheck(checks, {
      id: "ai-act-risk",
      label: "AI Act risk check",
      status: ai.legal_review_override ? "warning" : "blocked",
      message: ai.legal_review_override
        ? "This workflow is marked as prohibited-risk with admin legal-review override enabled for review/testing only."
        : "This workflow may fall under prohibited AI practices. Do not deploy without legal review.",
      details: { prohibited_reason: ai.prohibited_reason },
    });
  } else if (ai.ai_act_risk_level === "high_risk") {
    const missingReviewer = !ai.reviewer || !ai.reviewed_at;
    addCheck(checks, {
      id: "ai-act-risk",
      label: "AI Act risk check",
      status: missingReviewer ? "needs_reviewer" : "passed",
      message: missingReviewer
        ? "High-risk AI workflow requires explicit reviewer approval before publish."
        : "High-risk AI workflow has reviewer approval metadata.",
    });
  } else {
    addCheck(checks, {
      id: "ai-act-risk",
      label: "AI Act risk check",
      status: ai.ai_act_risk_level === "unknown" ? "warning" : "passed",
      message: ai.ai_act_risk_level === "unknown"
        ? "AI Act risk level is unknown; classify this workflow before production use."
        : "AI Act risk fields are recorded for this workflow.",
    });
  }

  const highImpactNodes = schema.nodes.filter(isHighImpactAction);
  const hasApproval = hasAnyHumanApprovalGate(schema);
  // "Blocked" is reserved for EXPLICIT oversight requirements (high-risk AI Act
  // classification or human_oversight_required set on the program). The
  // high-impact heuristic counts every agent node, so treating it as blocking
  // would stop effectively all autonomous workflows — it stays a warning.
  const explicitOversightRequired =
    ai.ai_act_risk_level === "high_risk" || ai.human_oversight_required;
  addCheck(checks, {
    id: "human-approval",
    label: "Human-approval requirement check",
    status: explicitOversightRequired && !hasApproval
      ? "blocked"
      : highImpactNodes.length > 0
        ? "warning"
        : "passed",
    message: explicitOversightRequired && !hasApproval
      ? "This workflow is marked as requiring human oversight but has no approval gate."
      : highImpactNodes.length > 0
        ? hasApproval
          ? "High-impact actions are present; verify approval gates match the customer risk assessment."
          : "High-impact actions run without a human approval gate; add one if these actions need review."
        : "No high-impact action requirement was detected.",
  });

  addCheck(checks, {
    id: "logging-retention",
    label: "Logging/retention check",
    status:
      ai.ai_act_risk_level === "high_risk" && workspace.execution_log_retention_days <= 0
        ? "blocked"
        : workspace.store_full_prompts || workspace.store_full_outputs
          ? "warning"
          : "passed",
    message:
      workspace.store_full_prompts || workspace.store_full_outputs
        ? "Workspace allows full prompt/output storage; confirm this is necessary and lawful for the workflow."
        : "Workspace defaults to metadata, hashes, and minimal execution logging.",
  });

  const secretExposureNodes = schema.nodes.filter((node) => {
    if (node.type !== "connection" || node.config.connector_type !== "http") return false;
    return Boolean(node.config.auth_value);
  });
  addCheck(checks, {
    id: "secret-exposure",
    label: "Secret exposure check",
    status: secretExposureNodes.length > 0 ? "warning" : "passed",
    message: secretExposureNodes.length > 0
      ? "One or more HTTP nodes contain inline auth material; use server-side credential helpers where possible."
      : "No inline HTTP auth material was detected in reviewed nodes.",
  });

  // Model-provider policy check is also eu_only — skipped in standard mode.
  const modelIssues = workspace.compliance_mode === "eu_only"
    ? flow.filter(
        (item) =>
          item.ai_model_call &&
          (!item.provider.dpa_available ||
            !item.provider.scc_available ||
            item.provider.trains_on_customer_data === "unknown")
      )
    : [];
  const modelProviderNames = [...new Set(modelIssues.map((i) => i.provider.name))];
  addCheck(checks, {
    id: "model-provider-policy",
    label: "Model-provider policy check",
    status: modelIssues.length > 0 ? "blocked" : "passed",
    message: modelIssues.length > 0
      ? `${modelProviderNames.join(", ")} ${modelProviderNames.length === 1 ? "lacks" : "lack"} complete DPA/SCC/training-policy evidence.`
      : "Model provider registry entries include DPA, transfer, and training-policy evidence.",
    details: { provider_names: modelProviderNames },
  });

  return checks;
}

// A "blocked" status now actually blocks runs and publishing (the run/publish
// routes 422 on it), matching what the check copy has promised all along.
// Blocked is only produced by explicit, opted-in conditions: eu_only-mode
// registry gaps, an AI-Act "prohibited" classification without legal override,
// an explicit human-oversight requirement with no approval gate, and high-risk
// workflows with zero log retention. Heuristic findings stay warnings.
// "needs_reviewer" additionally blocks PUBLISHING only — its check copy
// promises "reviewer approval before publish", not before every run.
export function hasBlockingComplianceChecks(
  checks: ComplianceCheck[],
  options: { includeNeedsReviewer?: boolean } = {}
) {
  return checks.some(
    (check) =>
      check.status === "blocked" ||
      (options.includeNeedsReviewer === true && check.status === "needs_reviewer")
  );
}

function uniqueProviders(flow: DataFlowPreviewItem[]) {
  const byId = new Map<string, Provider>();
  for (const item of flow) {
    if (item.provider.id !== "corelyx") byId.set(item.provider.id, item.provider);
  }
  return [...byId.values()];
}

export function generateComplianceExportReport({
  schema,
  workspace,
  context,
  program,
}: {
  schema: ProgramSchema;
  workspace?: WorkspaceComplianceSettings;
  context?: WorkflowProviderContext;
  program?: ProgramRowLike | null;
}): ComplianceExportReport {
  const resolvedWorkspace = workspace ?? DEFAULT_WORKSPACE_COMPLIANCE;
  const flow = buildDataFlowPreview(schema, resolvedWorkspace, context);
  const checks = validateWorkflowCompliance(schema, resolvedWorkspace, context, program);
  const aiGovernance = getAiGovernanceFields(schema, program);
  const providers = uniqueProviders(flow);

  return {
    report_type: "corelyx.workflow_compliance_export",
    generated_at: new Date().toISOString(),
    workflow: {
      id: program?.id ?? schema.program_id,
      name: program?.name ?? schema.program_name,
      version: program?.schema_version ?? null,
      last_reviewed_at: aiGovernance.reviewed_at,
    },
    workspace: resolvedWorkspace,
    ai_governance: aiGovernance,
    data_categories: [...new Set(flow.flatMap((item) => item.data_categories))],
    providers_and_subprocessors: providers.map((provider) => ({
      id: provider.id,
      name: provider.name,
      category: provider.category,
      purpose: provider.purpose,
      region: provider.default_region,
      transfer_basis: provider.transfer_basis,
      dpa_available: provider.dpa_available,
      scc_available: provider.scc_available,
      subprocessor_url: provider.subprocessor_url,
      privacy_url: provider.privacy_url,
      retention_notes: provider.retention_notes,
      status: provider.status,
    })),
    data_flow: flow,
    model_providers: flow
      .filter((item) => item.ai_model_call)
      .map((item) => ({
        provider_id: item.provider.id,
        provider_name: item.provider.name,
        model_name: item.model_name ?? "unknown",
        stores_prompts: item.provider.stores_prompts,
        stores_outputs: item.provider.stores_outputs,
        trains_on_customer_data: item.provider.trains_on_customer_data,
      })),
    logging: {
      prompt_input_output_logging: resolvedWorkspace.store_full_prompts || resolvedWorkspace.store_full_outputs
        ? "Full prompt/output logging may be enabled by workspace policy; secrets are redacted."
        : "Minimal metadata and hashes by default; full prompt/input/output payloads are not stored by default.",
      prompt_retention_days: resolvedWorkspace.prompt_retention_days,
      output_retention_days: resolvedWorkspace.output_retention_days,
      audit_log_fields: [
        "workflow_id",
        "workflow_version",
        "run_id",
        "user_id",
        "trigger_source",
        "timestamp",
        "node_id",
        "provider_id",
        "model_id",
        "prompt_hash",
        "input_hash",
        "output_hash",
        "payload_storage_flags",
        "tool_calls",
        "approval_request",
        "approval_decision",
        "approver_id",
        "data_region",
        "policy_checks",
        "block_warning_reasons",
        "errors",
        "retention_expiry",
      ],
    },
    human_approval_gates: flow
      .filter((item) => item.human_approval_gate)
      .map((item) => ({
        node_id: item.node_id,
        node_label: item.node_label,
        reason: item.ai_model_call
          ? "AI/model call approval gate"
          : "Human approval gate configured by execution mode or workflow node",
      })),
    checks,
    risk_classification_notes: aiGovernance.notes,
    dpia_notes:
      "Use this report as evidence input for GDPR Article 30 records, DPIAs, and AI governance reviews. Final compliance depends on use case, configuration, customer role, and the customer's legal basis.",
  };
}

export function renderComplianceReportHtml(report: ComplianceExportReport) {
  const escape = (value: unknown) =>
    String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const rows = report.data_flow
    .map(
      (item) => `
        <tr>
          <td>${escape(item.node_label)}</td>
          <td>${escape(item.provider.name)}</td>
          <td>${escape(item.region)}</td>
          <td>${escape(item.leaves_eea ? "Yes" : "No")}</td>
          <td>${escape(item.transfer_basis)}</td>
          <td>${escape(item.labels.join(", "))}</td>
        </tr>`
    )
    .join("");

  const checks = report.checks
    .map(
      (check) => `
        <li><strong>${escape(check.status)}</strong> - ${escape(check.label)}: ${escape(check.message)}</li>`
    )
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Corelyx Workflow Compliance Export - ${escape(report.workflow.name)}</title>
  <style>
    body { font-family: Arial, sans-serif; color: #111318; margin: 32px; line-height: 1.5; }
    h1, h2 { margin-bottom: 8px; }
    table { border-collapse: collapse; width: 100%; margin: 16px 0 28px; }
    th, td { border: 1px solid #d8dde6; padding: 8px; vertical-align: top; font-size: 12px; }
    th { background: #f3f5f8; text-align: left; }
    code { background: #f3f5f8; padding: 2px 4px; }
  </style>
</head>
<body>
  <h1>Workflow Compliance Export</h1>
  <p><strong>Workflow:</strong> ${escape(report.workflow.name)} (${escape(report.workflow.id)})</p>
  <p><strong>Generated:</strong> ${escape(report.generated_at)}</p>
  <p><strong>Workspace mode:</strong> ${escape(report.workspace.compliance_mode)}</p>
  <p><strong>AI Act risk:</strong> ${escape(report.ai_governance.ai_act_risk_level)}</p>
  <p>${escape(report.dpia_notes)}</p>

  <h2>Data Flow</h2>
  <table>
    <thead>
      <tr>
        <th>Node</th>
        <th>Provider</th>
        <th>Region</th>
        <th>Leaves EEA</th>
        <th>Transfer basis</th>
        <th>Labels</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>

  <h2>Checks</h2>
  <ul>${checks}</ul>

  <h2>Logging</h2>
  <p>${escape(report.logging.prompt_input_output_logging)}</p>
  <p><strong>Audit fields:</strong> ${escape(report.logging.audit_log_fields.join(", "))}</p>
</body>
</html>`;
}
