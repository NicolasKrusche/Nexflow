# FlowOS — Implementation Plan

> Visual Agentic Operating System
> *You describe what you want. AI designs the system. You review and tune it visually. It runs itself.*

---

## Table of Contents

1. [Project Principles](#1-project-principles)
2. [Architecture Decisions](#2-architecture-decisions)
3. [Repository Structure](#3-repository-structure)
4. [Database Schema](#4-database-schema)
5. [TypeScript Types & Validators](#5-typescript-types--validators)
6. [Validation Layer](#6-validation-layer)
7. [Visual Editor Spec](#7-visual-editor-spec)
8. [Runtime Engine Spec](#8-runtime-engine-spec)
9. [Connection / OAuth Manager Spec](#9-connection--oauth-manager-spec)
10. [Phase 0: Foundation](#phase-0-foundation-week-1-2)
11. [Phase 1: Genesis & Validation](#phase-1-genesis--validation-week-3-5)
12. [Phase 2: Visual Editor](#phase-2-visual-editor-week-6-9)
13. [Phase 3: Runtime Engine](#phase-3-runtime-engine-week-10-13)
14. [Phase 4: Triggers & Execution](#phase-4-triggers--execution-week-14-15)
15. [Phase 5: Native Connectors](#phase-5-native-connectors-week-16-19)
16. [Phase 6: Pre-flight & Polish](#phase-6-pre-flight--polish-week-20-22)
17. [Testing Strategy](#testing-strategy)
18. [Deployment Checklist](#deployment-checklist)
19. [Program Dashboard](#program-dashboard)
20. [Known Risks and Mitigations](#known-risks-and-mitigations)
21. [What Not To Build](#what-not-to-build-mvp-scope-guard)
22. [Coding Standards](#coding-standards)
23. [Phase 2 Post-MVP Preparation](#phase-2-post-mvp-preparation)

---

## 1. Project Principles

- **Schema-first** — Canonical schema defined and locked before any UI or runtime code
- **Fail loudly, early** — Validation errors surface before execution, never silently swallowed
- **Server-side secrets** — API keys and OAuth tokens never touch the frontend or logs
- **Translation layers only** — React Flow and LangGraph are adapters; the canonical schema is the product
- **Multi-tenancy ready from day one** — `org_id` on every user-scoped table, even if teams ship in Phase 2
- **Mobile-aware, desktop-optimized** — Full editing on desktop; run logs, approvals, and trigger controls on mobile

---

## 2. Architecture Decisions

| Concern | Choice | Rationale |
|---|---|---|
| Source of truth | Canonical JSON schema | Both React Flow and LangGraph are translation layers — schema drift is the #1 risk |
| Secret storage | Supabase Vault | Encrypted at rest, server-side only, referenced by ID never by value |
| Model routing | LiteLLM (self-hosted on Railway) | Unified interface for any provider, BYOK support, zero frontend exposure |
| App connectors | Native implementations | Full control, no Composio dependency, swappable per-connector |
| Agent runtime | LangGraph (Python, Railway) | Stateful graph execution, human-in-the-loop support built in |
| Trigger engine | Inngest | Reliable retries, cron, webhooks, event fan-out |
| Auth + DB | Supabase | Integrated RLS, Realtime, Vault, Auth — fewer moving parts |
| Frontend | Next.js 14 App Router + Tailwind | Server components reduce key exposure risk |
| Deployment | Vercel (Next.js) + Railway (Python) | Split deploys from monorepo |
| Monorepo | pnpm + Turborepo | Shared types between web and runtime packages |

---

## 3. Repository Structure

```
flowos/
├── apps/
│   ├── web/                        # Next.js 14 + Tailwind (→ Vercel)
│   │   ├── app/
│   │   │   ├── (auth)/             # login, signup, callback
│   │   │   ├── (app)/
│   │   │   │   ├── dashboard/
│   │   │   │   ├── connections/    # Connection manager
│   │   │   │   ├── api-keys/       # API key manager
│   │   │   │   ├── programs/
│   │   │   │   │   ├── new/        # Genesis flow
│   │   │   │   │   └── [id]/
│   │   │   │   │       ├── editor/ # React Flow editor
│   │   │   │   │       ├── runs/   # Run log
│   │   │   │   │       └── settings/
│   │   │   │   └── approvals/      # Human approval queue
│   │   │   └── api/                # API route handlers
│   │   │       ├── auth/
│   │   │       ├── connections/
│   │   │       ├── programs/
│   │   │       ├── genesis/
│   │   │       ├── runs/
│   │   │       └── keys/
│   │   ├── components/
│   │   │   ├── editor/             # React Flow editor shell
│   │   │   ├── nodes/              # TriggerNode, AgentNode, StepNode, ConnectionNode
│   │   │   ├── edges/              # DataFlowEdge, ControlFlowEdge, EventEdge
│   │   │   ├── sidebars/           # Node config panels
│   │   │   ├── panels/             # Run log panel, approval panel, version panel
│   │   │   └── ui/                 # shadcn/ui + custom components
│   │   └── lib/
│   │       ├── supabase/           # Client + server Supabase clients
│   │       ├── schema/             # Schema translation utilities
│   │       └── hooks/              # React hooks
│   │
│   └── runtime/                    # Python FastAPI + LangGraph (→ Railway)
│       ├── engine/
│       │   ├── executor.py         # Main execution orchestrator
│       │   ├── nodes/              # Per-node-type executors
│       │   └── state.py            # Run state management
│       ├── connectors/             # Native app connectors
│       │   ├── base.py             # IConnector interface
│       │   ├── gmail.py
│       │   ├── notion.py
│       │   ├── slack.py
│       │   ├── github.py
│       │   └── sheets.py
│       ├── validators/
│       │   ├── schema_validator.py # Pre-editor validation
│       │   └── preflight.py        # Pre-execution dry-run
│       └── api/
│           └── routes.py           # FastAPI endpoints
│
├── packages/
│   ├── schema/                     # Canonical schema (shared TS types)
│   │   ├── types.ts
│   │   ├── validators.ts           # Zod schemas
│   │   └── schema.json             # JSON Schema for Python validation
│   │
│   └── db/
│       ├── migrations/             # Supabase SQL migrations
│       └── types.ts                # Generated types (supabase gen types)
│
├── supabase/
│   ├── migrations/
│   ├── functions/                  # Edge functions (webhooks, callbacks)
│   └── config.toml
│
├── turbo.json
├── pnpm-workspace.yaml
└── .env.example
```

---

## 4. Database Schema

### Tables

```sql
-- Extends auth.users
CREATE TABLE public.profiles (
  id            UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id        UUID,                          -- null until Phase 2 teams
  display_name  TEXT,
  avatar_url    TEXT,
  tier          TEXT DEFAULT 'free' CHECK (tier IN ('free', 'pro', 'enterprise')),
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- User's AI provider keys (values stored in Vault, never here)
CREATE TABLE public.api_keys (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  org_id            UUID,
  name              TEXT NOT NULL,              -- e.g. "user_key_anthropic"
  provider          TEXT NOT NULL,              -- "anthropic" | "openai" | "google" | ...
  vault_secret_id   UUID NOT NULL,              -- Supabase Vault reference
  is_valid          BOOLEAN DEFAULT TRUE,
  last_validated_at TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- Connected apps (OAuth tokens / API keys stored in Vault)
CREATE TABLE public.connections (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  org_id            UUID,
  name              TEXT NOT NULL,              -- e.g. "gmail:primary"
  provider          TEXT NOT NULL,              -- "gmail" | "notion" | "slack" | ...
  auth_type         TEXT NOT NULL CHECK (auth_type IN ('oauth', 'api_key')),
  vault_secret_id   UUID NOT NULL,
  scopes            TEXT[],                     -- granted OAuth scopes
  metadata          JSONB,                      -- provider-specific metadata
  is_valid          BOOLEAN DEFAULT TRUE,
  last_validated_at TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

-- Programs (the canonical schema lives in schema column)
CREATE TABLE public.programs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  org_id              UUID,
  name                TEXT NOT NULL,
  description         TEXT,
  schema              JSONB NOT NULL,
  schema_version      INTEGER DEFAULT 1,
  execution_mode      TEXT DEFAULT 'supervised'
                        CHECK (execution_mode IN ('autonomous', 'supervised', 'manual')),
  is_active           BOOLEAN DEFAULT FALSE,
  conflict_policy     TEXT DEFAULT 'queue' CHECK (conflict_policy IN ('queue','skip','fail')),
  last_run_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

-- Program ↔ Connection many-to-many (which connections a program is allowed to access)
CREATE TABLE public.program_connections (
  program_id    UUID REFERENCES public.programs(id) ON DELETE CASCADE,
  connection_id UUID REFERENCES public.connections(id) ON DELETE CASCADE,
  PRIMARY KEY (program_id, connection_id)
);

-- Version history for rollback
CREATE TABLE public.program_versions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id     UUID NOT NULL REFERENCES public.programs(id) ON DELETE CASCADE,
  version        INTEGER NOT NULL,
  schema         JSONB NOT NULL,
  change_summary TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(program_id, version)
);

-- Program runs
CREATE TABLE public.runs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id      UUID NOT NULL REFERENCES public.programs(id) ON DELETE CASCADE,
  triggered_by    TEXT NOT NULL,                -- "manual"|"cron"|"webhook"|"event"|"program:{id}"
  trigger_payload JSONB,
  status          TEXT DEFAULT 'pending'
                    CHECK (status IN ('pending','running','paused','completed','failed','cancelled')),
  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  error_message   TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Per-node execution status within a run
CREATE TABLE public.node_executions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id          UUID NOT NULL REFERENCES public.runs(id) ON DELETE CASCADE,
  node_id         TEXT NOT NULL,                -- matches node.id in the schema
  status          TEXT DEFAULT 'pending'
                    CHECK (status IN ('pending','queued','running','waiting_approval','completed','failed','skipped')),
  input_payload   JSONB,
  output_payload  JSONB,
  error_message   TEXT,
  retry_count     INTEGER DEFAULT 0,
  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Human approval queue
CREATE TABLE public.approvals (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  node_execution_id   UUID NOT NULL REFERENCES public.node_executions(id) ON DELETE CASCADE,
  user_id             UUID NOT NULL REFERENCES public.profiles(id),
  status              TEXT DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  context             JSONB,                    -- what the user needs to review
  decision_note       TEXT,
  decided_at          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- Stored trigger configurations
CREATE TABLE public.triggers (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id UUID NOT NULL REFERENCES public.programs(id) ON DELETE CASCADE,
  type       TEXT NOT NULL CHECK (type IN ('manual','cron','webhook','event','program')),
  config     JSONB NOT NULL,
  is_active  BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Billing usage tracking
CREATE TABLE public.usage (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  org_id           UUID,
  period_start     DATE NOT NULL,
  period_end       DATE NOT NULL,
  program_count    INTEGER DEFAULT 0,
  execution_count  INTEGER DEFAULT 0,
  connection_count INTEGER DEFAULT 0,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, period_start)
);

-- Write-access resource locking (concurrent Program conflict prevention)
CREATE TABLE public.resource_locks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_type   TEXT NOT NULL,                -- "connection" | "program"
  resource_id     UUID NOT NULL,
  locked_by_run_id UUID REFERENCES public.runs(id) ON DELETE CASCADE,
  acquired_at     TIMESTAMPTZ DEFAULT NOW(),
  expires_at      TIMESTAMPTZ NOT NULL,
  UNIQUE(resource_type, resource_id)
);
```

### RLS

Enable RLS on every table. Base policy pattern: users own their rows via `user_id = auth.uid()`. Add org-based policies in Phase 2.

```sql
ALTER TABLE public.profiles          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_keys          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connections       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.programs          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.program_versions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.runs              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.node_executions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approvals         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.triggers          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usage             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.resource_locks    ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own profile"    ON public.profiles    FOR ALL USING (auth.uid() = id);
CREATE POLICY "own api_keys"   ON public.api_keys    FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "own connections" ON public.connections FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "own programs"   ON public.programs    FOR ALL USING (auth.uid() = user_id);
-- program_versions, runs, node_executions, etc. inherit via JOIN — add similar policies
```

---

## 5. Canonical Schema

This is the most important engineering artifact in the project. It is the **contract** every part of the system signs. The visual editor reads it, the runtime executes it, the validation layer checks it, the genesis prompt produces it, and the version system stores it. Every part of the stack is a consumer of this schema.

**Design principles:**
- No layer owns it — React Flow and LangGraph are translation layers only
- Everything required for execution is embedded — the runtime never queries the DB mid-execution to understand a node
- Secrets are never in the schema — API keys are referenced by ID, resolved from Vault at runtime
- Append-only version history — every state is recoverable
- Pure JSON — no functions, no classes, no circular references

### Full Type Spec (`packages/schema/types.ts`)

```typescript
// ─── ROOT ─────────────────────────────────────────────────────────────────

interface ProgramSchema {
  version: "1.0";                    // Schema format version, not program version
  program_id: string;
  program_name: string;
  created_at: string;                // ISO 8601
  updated_at: string;                // ISO 8601
  execution_mode: ExecutionMode;
  nodes: Node[];
  edges: Edge[];
  triggers: Trigger[];
  version_history: VersionSnapshot[];
  metadata: ProgramMetadata;
}

type ExecutionMode = "autonomous" | "approval_required" | "supervised";

// ─── METADATA ─────────────────────────────────────────────────────────────

interface ProgramMetadata {
  description: string;               // Original user description (genesis input)
  genesis_model: string;             // Model used to generate this schema
  genesis_timestamp: string;         // ISO 8601
  tags: string[];
  is_active: boolean;
  last_run_id: string | null;
  last_run_status: RunStatus | null;
  last_run_timestamp: string | null;
}

type RunStatus = "success" | "failed" | "partial" | "running" | "waiting_approval";

// ─── NODES ────────────────────────────────────────────────────────────────

type Node = TriggerNode | AgentNode | StepNode | ConnectionNode;

interface NodeBase {
  id: string;                        // Unique within program, e.g. "n1"
  label: string;
  description: string;               // Shown in sidebar
  position: { x: number; y: number };
  status: NodeStatus;
}

type NodeStatus = "idle" | "running" | "success" | "failed" | "waiting_approval" | "skipped";

// TRIGGER NODE
interface TriggerNode extends NodeBase {
  type: "trigger";
  connection: string | null;
  config: TriggerConfig;
}

type TriggerConfig =
  | { trigger_type: "cron";           expression: string; timezone: string }
  | { trigger_type: "event";          source: string; event: string; filter: object | null }
  | { trigger_type: "webhook";        endpoint_id: string; method: "POST" | "GET" }
  | { trigger_type: "manual" }
  | { trigger_type: "program_output"; source_program_id: string; on_status: RunStatus[] }

// AGENT NODE
interface AgentNode extends NodeBase {
  type: "agent";
  connection: string | null;         // If agent uses a connected app as a tool
  config: AgentConfig;
}

interface AgentConfig {
  model: string | "__USER_ASSIGNED__";
  api_key_ref: string | "__USER_ASSIGNED__"; // References key ID in Supabase Vault
  system_prompt: string;
  input_schema: DataSchema | null;
  output_schema: DataSchema | null;
  requires_approval: boolean;
  approval_timeout_hours: number;
  scope_required: string | null;
  scope_access: "read" | "write" | "read_write";
  retry: RetryConfig;
  tools: string[];
}

// STEP NODE
interface StepNode extends NodeBase {
  type: "step";
  connection: null;                  // Step nodes never connect to external apps
  config: StepConfig;
}

type StepConfig =
  | { logic_type: "transform"; transformation: string; input_schema: DataSchema | null; output_schema: DataSchema | null }
  | { logic_type: "filter";    condition: string; pass_schema: DataSchema | null }
  | { logic_type: "branch";    conditions: BranchCondition[]; default_branch: string }

interface BranchCondition {
  condition: string;                 // Expression evaluating to boolean
  target_node_id: string;
}

// CONNECTION NODE
interface ConnectionNode extends NodeBase {
  type: "connection";
  connection: string;                // Must match a named connection exactly
  config: {
    scope_access: "read" | "write" | "read_write";
    scope_required: string[];
  };
}

// ─── EDGES ────────────────────────────────────────────────────────────────

interface Edge {
  id: string;
  from: string;                      // Source node id
  to: string;                        // Target node id
  type: EdgeType;
  data_mapping: DataMapping | null;  // How source output fields map to target input fields
  condition: string | null;          // Only for control_flow edges
  label: string | null;
}

type EdgeType = "data_flow" | "control_flow" | "event_subscription";

interface DataMapping {
  // e.g. { "summary": "email_summary" } means source.summary → target.email_summary
  [sourceField: string]: string;
}

// ─── SHARED TYPES ─────────────────────────────────────────────────────────

interface DataSchema {
  type: "object" | "string" | "number" | "boolean" | "array";
  properties?: { [key: string]: DataSchema };
  items?: DataSchema;
  required?: string[];
}

interface RetryConfig {
  max_attempts: number;              // 1–5
  backoff: "none" | "linear" | "exponential";
  backoff_base_seconds: number;
  fail_program_on_exhaust: boolean;  // false = skip node and continue
}

// ─── TRIGGERS ─────────────────────────────────────────────────────────────

// Top-level triggers array is the runtime's quick-access index.
// Must always mirror the trigger node configs exactly.
interface Trigger {
  node_id: string;
  type: TriggerConfig["trigger_type"];
  is_active: boolean;
  last_fired: string | null;         // ISO 8601
  next_scheduled: string | null;     // ISO 8601, cron only
}

// ─── VERSION HISTORY ──────────────────────────────────────────────────────

interface VersionSnapshot {
  version_number: number;            // Increments from 0 (genesis)
  timestamp: string;                 // ISO 8601
  changed_by: "genesis" | "user" | "system";
  change_summary: string;
  snapshot: {
    nodes: Node[];
    edges: Edge[];
    triggers: Trigger[];
  };
}
```

### Zod Validators (`packages/schema/validators.ts`)

The Zod schema mirrors the TypeScript types above and is the authoritative runtime validator used by both the genesis API route and the editor save endpoint. Key constraints to encode:

- `max_attempts` in RetryConfig: `z.number().int().min(1).max(5)`
- `model` in AgentConfig: `z.string().min(1)` — accepts `"__USER_ASSIGNED__"` as a valid string
- `connection` on StepNode: `z.null()` — enforced, not optional
- `version_number` in VersionSnapshot: `z.number().int().min(0)`
- `trigger_type` discriminated union on `TriggerConfig`

Full Zod implementation is in `packages/schema/validators.ts`. The Zod schemas are the source of truth for runtime parsing — the TypeScript types above are derived from them via `z.infer<>`.

### Translation Layer (`apps/web/lib/schema/`)

Two pure functions. These are the most important functions in the frontend codebase:

```typescript
// Schema → React Flow props (called on every editor load)
function toReactFlow(schema: ProgramSchema): {
  nodes: ReactFlowNode[];
  edges: ReactFlowEdge[];
}

// React Flow state → Schema (called on every editor save, with 2s debounce)
// Takes existing schema as third arg to preserve everything RF doesn't know about:
// retry config, system prompts, version history, metadata, etc.
function fromReactFlow(
  nodes: ReactFlowNode[],
  edges: ReactFlowEdge[],
  existing: ProgramSchema
): ProgramSchema

// Schema → LangGraph definition (called by runtime at execution start)
function toLangGraph(schema: ProgramSchema): LangGraphDefinition
```

Save flow: `fromReactFlow` → `validatePostGenesis` → persist to DB (only if valid or user force-saves with warnings).
Load flow: fetch from DB → `toReactFlow` → render.

The roundtrip invariant — `fromReactFlow(toReactFlow(schema), existing) deepEquals schema` — must be tested and enforced. Any drift here is a silent data loss bug.

### Key Design Decisions

| Decision | Rationale |
|---|---|
| `__USER_ASSIGNED__` sentinels | Genesis can't know the user's API keys. Sentinels make incomplete state explicit and detectable rather than silently null. |
| `data_mapping` on edges | Explicit field mapping between nodes prevents silent type coercion bugs. Validation checks mapped fields exist in source `output_schema`. |
| `input_schema` / `output_schema` on nodes | Genesis populates these as best it can. Validation checks compatibility across every data_flow edge. User can edit in sidebar. |
| `fail_program_on_exhaust` | Lets users decide if one failing node kills the whole program or gets skipped. Critical for long autonomous pipelines. |
| Triggers mirrored at root | The `triggers[]` array is a runtime index — the runtime reads it without walking all nodes. Must stay in sync with trigger node configs. |

---

## 6. Validation Layer

Think of it like a compiler. Genesis writes the code. Validation compiles it. The runtime executes it. You never execute uncompiled code.

The validation layer runs at **two distinct moments**:
- **Post-genesis** — synchronous, schema-only, no external calls. Runs before the user ever sees the graph.
- **Pre-flight** — async, makes live calls to verify OAuth tokens and API keys. Runs before first execution.

Both passes use the same rule engine and return the same result shape.

### Core Types

```typescript
// apps/web/lib/validation/types.ts

interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
  node_states: { [node_id: string]: NodeValidationState };
}

interface ValidationError {
  code: ErrorCode;
  severity: "blocking" | "critical";
  node_id: string | null;         // null = program-level error
  edge_id: string | null;
  message: string;                // Human-readable, shown in UI
  fix_suggestion: string;         // Actionable hint shown in sidebar
}

interface ValidationWarning {
  code: WarningCode;
  node_id: string | null;
  message: string;
  fix_suggestion: string;
}

type NodeValidationState = "valid" | "error" | "warning" | "unassigned";
```

`node_states` drives the visual editor — every node gets a color from its state: red (error), yellow (warning), grey (unassigned), green (valid).

### Function Signatures

```typescript
// Post-genesis: synchronous, no external calls
function validatePostGenesis(
  schema: ProgramSchema,
  availableConnections: Connection[]
): ValidationResult

// Pre-flight: async, makes live calls
async function validatePreFlight(
  schema: ProgramSchema,
  availableConnections: Connection[],
  userApiKeys: ApiKeyRef[]
): Promise<ValidationResult>
```

### Post-Genesis Rules (Structural)

#### Graph Integrity

```typescript
// ERR_001: No trigger node
if (nodes.filter(n => n.type === "trigger").length === 0)
  error("ERR_001", null, "Program has no trigger",
    "Add a trigger node to define when this program starts")

// ERR_002: Multiple trigger nodes
if (nodes.filter(n => n.type === "trigger").length > 1)
  error("ERR_002", null, "Program has multiple triggers",
    "Only one trigger node is allowed. Delete the extra trigger or split into separate programs")

// ERR_003: Isolated node (no edges)
nodes.forEach(node => {
  const connected = edges.some(e => e.from === node.id || e.to === node.id)
  if (!connected)
    error("ERR_003", node.id, `${node.label} is not connected to anything`,
      "Draw a connection from this node to another node")
})

// ERR_004: Edge references non-existent node
edges.forEach(edge => {
  if (!nodeIds.includes(edge.from))
    error("ERR_004", null, `Edge ${edge.id} references missing source node`,
      "Delete this edge and redraw it from a valid node")
  if (!nodeIds.includes(edge.to))
    error("ERR_004", null, `Edge ${edge.id} references missing target node`,
      "Delete this edge and redraw it to a valid node")
})

// ERR_005: Circular edges without a branch node as exit
const cycles = detectCycles(nodes, edges)
cycles.forEach(cycle => {
  const hasBranchNode = cycle.some(id => {
    const node = findNode(id)
    return node.type === "step" && node.config.logic_type === "branch"
  })
  if (!hasBranchNode)
    error("ERR_005", null, "Circular connection detected with no exit condition",
      "Add a branch node with an exit condition to break the loop")
})

// ERR_006: Node count exceeded
if (nodes.length > 12)
  error("ERR_006", null, "Program exceeds maximum of 12 nodes",
    "Split this program into two smaller programs and use a program_output trigger to chain them")
```

#### Connection References

```typescript
const availableConnectionNames = availableConnections.map(c => c.name)

// ERR_007: Node references unavailable connection
nodes.forEach(node => {
  if (node.connection && !availableConnectionNames.includes(node.connection))
    error("ERR_007", node.id,
      `${node.label} uses ${node.connection} which is not connected to this program`,
      "Go to program settings and add this connection, or change the node to use an available connection")
})

// ERR_008: Trigger event source not in connections
triggers.forEach(trigger => {
  if (trigger.type === "event") {
    const config = trigger.config as EventTriggerConfig
    if (!availableConnectionNames.includes(config.source))
      error("ERR_008", trigger.node_id,
        `Trigger listens to ${config.source} which is not connected`,
        "Add this connection to the program or change the trigger source")
  }
})

// ERR_009: Step node has a connection (must never)
nodes.forEach(node => {
  if (node.type === "step" && node.connection !== null)
    error("ERR_009", node.id,
      `Step node ${node.label} cannot connect to an external app`,
      "Step nodes are for logic only. Use an agent node to interact with apps")
})
```

#### Data Flow

```typescript
// ERR_010: Data mapping references non-existent field
edges.forEach(edge => {
  if (!edge.data_mapping) return
  const sourceNode = findNode(edge.from)
  const outputSchema = sourceNode.config.output_schema
  if (!outputSchema) return
  Object.keys(edge.data_mapping).forEach(field => {
    if (!schemaHasField(outputSchema, field))
      error("ERR_010", null,
        `Edge maps field "${field}" which does not exist in ${sourceNode.label}'s output`,
        `Remove this mapping or update ${sourceNode.label}'s output schema to include "${field}"`)
  })
})

// ERR_011: Input/output type mismatch between connected nodes
edges.forEach(edge => {
  if (edge.type !== "data_flow") return
  const source = findNode(edge.from)
  const target = findNode(edge.to)
  const outputSchema = source.config?.output_schema
  const inputSchema = target.config?.input_schema
  if (!outputSchema || !inputSchema) return
  const incompatible = findIncompatibleFields(outputSchema, inputSchema, edge.data_mapping)
  incompatible.forEach(field => {
    error("ERR_011", null,
      `Type mismatch: ${source.label} outputs ${field.type} but ${target.label} expects ${field.expected}`,
      "Update the data mapping on this edge or adjust one of the node schemas")
  })
})
```

#### Sentinel Values

```typescript
// WARN_001: Model not yet assigned (genesis placeholder)
nodes.forEach(node => {
  if (node.type !== "agent") return
  if (node.config.model === "__USER_ASSIGNED__")
    warning("WARN_001", node.id,
      `${node.label} has no AI model assigned`,
      "Open this node and assign a model and API key before running")
})

// WARN_002: System prompt is empty
nodes.forEach(node => {
  if (node.type !== "agent") return
  if (!node.config.system_prompt || node.config.system_prompt.trim() === "")
    warning("WARN_002", node.id,
      `${node.label} has no system prompt`,
      "Add a system prompt to define what this agent should do")
})
```

#### Scope Conflicts

```typescript
// ERR_012: Node requests write scope but program only granted read
nodes.forEach(node => {
  if (!node.connection) return
  const connection = findConnection(node.connection, availableConnections)
  const nodeNeedsWrite = node.config?.scope_access === "write" ||
                         node.config?.scope_access === "read_write"
  const programGrantedWrite = connection.scopes.some(s => s.includes("write"))
  if (nodeNeedsWrite && !programGrantedWrite)
    error("ERR_012", node.id,
      `${node.label} needs write access to ${node.connection} but only read was granted`,
      "Go to connection settings and grant write permission, or change this node to read-only")
})

// WARN_003: Two programs share write access to same connection
// Runs against all user's programs, not just current one
async function checkCrossProgramConflicts(
  schema: ProgramSchema,
  allUserPrograms: ProgramSchema[]
): Promise<ValidationWarning[]>
```

### Pre-Flight Rules (Live Checks)

All run async in parallel where possible:

```typescript
// PRE_001: OAuth token expired or revoked
await Promise.all(availableConnections.map(async connection => {
  const isValid = await checkOAuthToken(connection)
  if (!isValid)
    error("PRE_001", null,
      `Connection ${connection.name} is disconnected or expired`,
      "Go to connections and re-authenticate")
}))

// PRE_002: API key invalid or quota exhausted
await Promise.all(assignedApiKeys.map(async keyRef => {
  const status = await probeApiKey(keyRef)
  if (!status.valid)
    error("PRE_002", null, `API key ${keyRef.label} is invalid`,
      "Go to API keys and update this key")
  if (status.quota_exhausted)
    error("PRE_002", null, `API key ${keyRef.label} has no remaining quota`,
      "Check your usage on the provider's dashboard")
}))

// PRE_003: Required OAuth scope not granted
await Promise.all(nodes.map(async node => {
  if (!node.config?.scope_required) return
  const connection = findConnection(node.connection, availableConnections)
  const hasScope = await checkScope(connection, node.config.scope_required)
  if (!hasScope)
    error("PRE_003", node.id,
      `${node.label} requires ${node.config.scope_required} but it was not granted`,
      "Re-authenticate this connection and grant the required permission")
}))

// PRE_004: Sentinel values still present at execution time
nodes.forEach(node => {
  if (node.type !== "agent") return
  if (node.config.model === "__USER_ASSIGNED__" ||
      node.config.api_key_ref === "__USER_ASSIGNED__")
    error("PRE_004", node.id,
      `${node.label} still has unassigned model or API key`,
      "Open this node and assign a model before running")
})
```

### How Errors Surface in the UI

**In the diagram:**
- Red border + red dot = blocking error on that node
- Yellow border + yellow dot = warning on that node
- Grey fill = unassigned sentinel values present
- Green border = fully valid

**In the node sidebar (when node is selected):**
- List of all errors and warnings for that node
- Each entry includes its `fix_suggestion`
- Direct action buttons where possible (e.g. "Go to connections")

**Program-level errors** (no specific node) shown in a persistent banner above the diagram.

**The Run button is disabled** when `ValidationResult.valid === false`. Tooltip on hover explains why.

### Error Code Reference

| Code | Trigger | Blocking |
|---|---|---|
| ERR_001 | No trigger node | Yes |
| ERR_002 | Multiple triggers | Yes |
| ERR_003 | Isolated node | Yes |
| ERR_004 | Invalid edge reference | Yes |
| ERR_005 | Cycle without exit condition | Yes |
| ERR_006 | Node count exceeded | Yes |
| ERR_007 | Missing connection reference | Yes |
| ERR_008 | Trigger source not connected | Yes |
| ERR_009 | Step node has connection | Yes |
| ERR_010 | Bad data mapping field | Yes |
| ERR_011 | Input/output type mismatch | Yes |
| ERR_012 | Scope insufficient | Yes |
| PRE_001 | OAuth token expired | Yes |
| PRE_002 | API key invalid/exhausted | Yes |
| PRE_003 | Required scope not granted | Yes |
| PRE_004 | Sentinel value at execution | Yes |
| WARN_001 | No model assigned | No |
| WARN_002 | Empty system prompt | No |
| WARN_003 | Cross-program write conflict | No |

### Implementation Location

```
apps/web/lib/validation/
├── types.ts              # ValidationResult, ValidationError, ValidationWarning
├── post-genesis.ts       # validatePostGenesis() — all ERR_001–ERR_012, WARN_001–WARN_003
├── pre-flight.ts         # validatePreFlight() — all PRE_001–PRE_004
├── rules/
│   ├── graph-integrity.ts
│   ├── connection-refs.ts
│   ├── data-flow.ts
│   ├── sentinels.ts
│   └── scope-conflicts.ts
└── utils/
    ├── cycle-detection.ts   # DFS cycle detector
    └── schema-helpers.ts    # findNode, findConnection, schemaHasField, etc.
```

---

## 7. Visual Editor Spec

The diagram is the primary interface for understanding, editing, and controlling a Program. Every design decision here affects user trust. It must feel like a professional tool.

### State Model

The editor is a controlled component — it never mutates the schema directly. Every change goes through a reducer that produces a new schema version, and the editor re-renders from that.

```typescript
// apps/web/lib/editor/state.ts
interface EditorState {
  schema: ProgramSchema;
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
  validationResult: ValidationResult | null;
  isDirty: boolean;
  isSaving: boolean;
  runStatus: RunStatus | null;       // Live execution state
  history: ProgramSchema[];          // Local undo stack (last 20 states)
  historyIndex: number;
}
```

A single `useEditorReducer` hook handles all state transitions. The editor never calls the database directly — it dispatches actions.

Action set: `ADD_NODE`, `REMOVE_NODE`, `UPDATE_NODE`, `ADD_EDGE`, `REMOVE_EDGE`, `UNDO`, `REDO`, `VALIDATE`, `SAVE`, `UPDATE_NODE_STATUS`, `OPEN_APPROVAL_PANEL`, `RUN`, `STOP_RUN`.

### Translation: Schema → React Flow

Runs on load and whenever the schema changes externally (e.g. a run updates node statuses). Passes `validationResult` so nodes render their error/warning state immediately.

```typescript
function toReactFlow(
  schema: ProgramSchema,
  validationResult: ValidationResult | null
): { nodes: ReactFlowNode[]; edges: ReactFlowEdge[] } {
  const nodes = schema.nodes.map(node => ({
    id: node.id,
    type: node.type,                 // Maps to custom node component
    position: node.position,
    data: {
      label: node.label,
      description: node.description,
      connection: node.connection,
      status: node.status,
      validationState: validationResult?.node_states[node.id] ?? "valid",
      errors: validationResult?.errors.filter(e => e.node_id === node.id) ?? [],
      warnings: validationResult?.warnings.filter(w => w.node_id === node.id) ?? [],
      config: node.config,
    },
    draggable: true,
    selectable: true,
  }))

  const edges = schema.edges.map(edge => ({
    id: edge.id,
    source: edge.from,
    target: edge.to,
    type: edge.type,
    label: edge.label ?? undefined,
    data: {
      condition: edge.condition,
      data_mapping: edge.data_mapping,
      validationErrors: validationResult?.errors.filter(e => e.edge_id === edge.id) ?? [],
    },
    animated: edge.type === "event_subscription",
    markerEnd: { type: MarkerType.ArrowClosed },
  }))

  return { nodes, edges }
}
```

### Translation: React Flow → Schema

Runs on every user edit (node moved, edge drawn, node deleted). React Flow only owns position and topology — everything else is preserved from the existing schema untouched.

```typescript
function fromReactFlow(
  rfNodes: ReactFlowNode[],
  rfEdges: ReactFlowEdge[],
  existing: ProgramSchema
): ProgramSchema {
  const existingNodes = Object.fromEntries(existing.nodes.map(n => [n.id, n]))
  const existingEdges = Object.fromEntries(existing.edges.map(e => [e.id, e]))

  const nodes = rfNodes.map(rfNode => ({
    ...existingNodes[rfNode.id],     // Preserve all config RF doesn't know about
    position: rfNode.position,       // RF owns position
    label: rfNode.data.label,
    description: rfNode.data.description,
  }))

  const edges = rfEdges.map(rfEdge => ({
    ...existingEdges[rfEdge.id],     // Preserve data_mapping, condition, etc.
    from: rfEdge.source,
    to: rfEdge.target,
    label: rfEdge.label ?? null,
  }))

  return { ...existing, nodes, edges, updated_at: new Date().toISOString() }
}
```

### Custom Node Components

All four node types share a `NodeShell` base. Border color is driven by `validationState`; status icon by `status`.

```tsx
// Border colors by validation state
const borderColor = {
  valid:      selected ? "border-blue-500" : "border-slate-600",
  error:      "border-red-500",
  warning:    "border-yellow-400",
  unassigned: "border-slate-400 border-dashed",
}[data.validationState]

// Status icon (top-right of node)
const statusIcon = {
  idle:             null,
  running:          <Spinner className="w-3 h-3 text-blue-400" />,
  success:          <CheckCircle className="w-3 h-3 text-green-400" />,
  failed:           <XCircle className="w-3 h-3 text-red-400" />,
  waiting_approval: <Clock className="w-3 h-3 text-yellow-400" />,
  skipped:          <MinusCircle className="w-3 h-3 text-slate-400" />,
}[data.status]
```

Node accent colors by type: **Trigger** = green, **Agent** = purple, **Step** = blue, **Connection** = slate.

Agent nodes show a `"No model"` badge when `config.model === "__USER_ASSIGNED__"` and a `"Needs approval"` badge when `config.requires_approval === true`.

Trigger nodes have no target handle (source only). All other nodes have both.

### Node Configuration Sidebar

Slides in from the right on node click. Width: 320px. Never covers the full canvas.

Tabs and fields by node type:

**Agent** tabs: `Model | Prompt | Tools | Retry | Permissions`
Fields: model selector (dropdown of user's saved API keys by provider), system prompt textarea, requires_approval toggle, approval_timeout_hours input, scope_access selector, retry config (max_attempts, backoff type, base seconds, fail_on_exhaust toggle).

**Trigger** tabs: `Config | Schedule/Event | Filters`
Fields: trigger type selector, type-specific fields (cron expression + timezone, event source + event name + filter, webhook method, program selector + on_status).

**Step** tabs: `Logic | Input Schema | Output Schema`
Fields: logic type selector, expression/condition/branch editor per logic_type.

**Connection** tabs: `Permissions`
Fields: scope access selector, scope_required list.

All sidebar changes call `onUpdate(nodeId, partialNodeConfig)` which dispatches through the reducer → new schema version.

Validation errors and warnings for the selected node are shown at the top of the sidebar with their `fix_suggestion` text and direct action buttons where applicable (e.g. "Go to Connections").

### Toolbar (fixed top, not floating)

```
[← Back]  [Program name / Saved]  |  [+ Agent] [+ Step] [+ Trigger]  |  [↩] [↪]  [History]  [Validate]  [Save]  [Run ▶]
```

- Back arrow: navigate to dashboard (prompts if `isDirty`)
- Save status: "Saved" or "Unsaved changes"
- Add node buttons: drop new node at canvas center, open sidebar immediately
- Undo/Redo: walks `history` stack (depth 20)
- History: opens version panel to browse/restore snapshots
- Validate: runs `validatePostGenesis` on demand, updates node states
- Save: disabled when not dirty or saving in progress
- Run: see Run Button spec below

### The Run Button

| State | Appearance | Action |
|---|---|---|
| Validation errors present | Green, 40% opacity, cursor-not-allowed | Tooltip: "Fix validation errors before running" |
| Ready | Green, full opacity | Opens pre-flight check → then starts run |
| Running | Red "Stop" button | Cancels run |
| `waiting_approval` | Yellow pulsing "Approval needed" | Opens approval panel |

### Live Run Visualisation

When a Program is running the diagram becomes a live status board. Node borders animate, active edges pulse in the direction of data flow, completed nodes turn green in sequence.

```typescript
// Subscribe to node status changes via Supabase Realtime (no polling)
const channel = supabase
  .channel(`run:${runId}`)
  .on("postgres_changes", {
    event: "UPDATE",
    schema: "public",
    table: "node_executions",
    filter: `run_id=eq.${runId}`,
  }, payload => {
    dispatch({ type: "UPDATE_NODE_STATUS", node_id: payload.new.node_id, status: payload.new.status })
  })
  .subscribe()
```

The runtime writes to `node_executions` as it progresses. Supabase Realtime pushes to the editor. Each node's `status` field drives its border color and icon in real time.

### Mobile Behaviour

On viewport < 768px:
- Canvas renders read-only — no drag, no edit, no sidebar
- Top banner: "Edit on desktop"
- Node statuses still update in real time
- Simplified list view shows all nodes and their current status
- Run / Stop controls remain available
- Run logs are accessible

PWA install prompt shown on mobile after the user's second visit.

### Keyboard Shortcuts

| Key | Action |
|---|---|
| `Delete` / `Backspace` | Delete selected node or edge |
| `Cmd/Ctrl + Z` | Undo |
| `Cmd/Ctrl + Shift + Z` | Redo |
| `Cmd/Ctrl + S` | Save |
| `Cmd/Ctrl + Enter` | Run (if valid) |
| `Escape` | Close sidebar / deselect |
| `Cmd/Ctrl + A` | Select all nodes |
| `Space + drag` | Pan canvas |
| `Scroll` | Zoom |

### Quality Bar

Three things separate this from a demo:

1. **Undo is deep and reliable** — every change is in the history stack, Cmd+Z always works, nothing is irreversible except explicit deletes (which confirm first)
2. **The diagram never lies** — node status, validation state, and run state are always in sync via Supabase Realtime, no stale UI
3. **Errors are actionable** — every red node has a specific message and a specific fix, the user is never left wondering what went wrong

---

## 8. Runtime Engine Spec

Everything built so far — the schema, validation, connections, editor — exists to produce input for this layer. The runtime is what makes Programs actually do things in the world.

### Core Principles

- **Stateless between nodes** — each node receives input, does work, produces output, and hands off. No in-memory state between executions. All state lives in the database.
- **Resumable** — if the server dies mid-execution, the runtime picks up exactly where it left off on restart. No run is lost, no node re-executes unnecessarily.
- **Isolated per run** — two simultaneous runs of the same Program do not share state. Two different Programs running concurrently do not interfere.
- **Secrets never held** — API keys and OAuth tokens are fetched fresh from Vault at the moment needed and discarded immediately after the node completes.

### Runtime Data Model

```typescript
// apps/runtime/engine/types.ts

interface ProgramRun {
  id: string;
  program_id: string;
  user_id: string;
  status: RunStatus;
  trigger_type: string;
  trigger_payload: object | null;
  started_at: string;               // ISO 8601
  completed_at: string | null;
  error: RunError | null;
  execution_mode: ExecutionMode;
  schema_version: number;
}

interface NodeRunState {
  id: string;
  run_id: string;
  node_id: string;
  status: NodeStatus;
  input: object | null;
  output: object | null;
  error: NodeError | null;
  attempts: number;
  started_at: string | null;
  completed_at: string | null;
  approval_requested_at: string | null;
  approval_resolved_at: string | null;
  approval_resolved_by: string | null; // user_id
  approval_decision: "approved" | "rejected" | null;
}

interface RunError {
  code: string;
  message: string;
  node_id: string | null;
  recoverable: boolean;
}

interface NodeError {
  code: string;
  message: string;
  raw: string | null;               // Raw error from provider
  attempt: number;
}
```

### Execution Engine

Built on LangGraph. The engine compiles a `ProgramSchema` into a LangGraph `StateGraph` at run time:

```typescript
class ProgramExecutionEngine {
  async compile(schema: ProgramSchema): Promise<CompiledGraph> {
    const graph = new StateGraph({ channels: this.buildStateChannels(schema) })

    for (const node of schema.nodes) {
      graph.addNode(node.id, this.buildNodeExecutor(node))
    }

    for (const edge of schema.edges) {
      if (edge.type === "control_flow" && edge.condition) {
        graph.addConditionalEdges(
          edge.from,
          this.buildConditionEvaluator(edge.condition),
          { true: edge.to, false: "__end__" }
        )
      } else {
        graph.addEdge(edge.from, edge.to)
      }
    }

    const triggerNode = schema.nodes.find(n => n.type === "trigger")
    graph.setEntryPoint(triggerNode.id)
    return graph.compile()
  }

  private buildStateChannels(schema: ProgramSchema): StateChannels {
    // Each node gets its own channel — data flows without shared memory
    return schema.nodes.reduce((channels, node) => ({
      ...channels,
      [node.id]: { value: null, default: () => null }
    }), {})
  }
}
```

### Node Executors

**Trigger executor** — passes trigger payload from the run record into the graph as the first node's output. No external calls.

**Agent executor:**

```typescript
private buildAgentExecutor(node: AgentNode): NodeExecutor {
  return async (state, config) => {
    const { runId } = config.configurable
    await this.updateNodeState(runId, node.id, "running", state[node.id])

    if (node.config.requires_approval) {
      const approved = await this.requestApproval(runId, node, state)
      if (!approved) {
        await this.updateNodeState(runId, node.id, "skipped", state[node.id])
        return { [node.id]: null }
      }
    }

    const input = this.resolveInput(node, state)
    const output = await this.executeWithRetry(
      () => this.callAgent(node, input, runId),
      node.config.retry, runId, node.id
    )

    await this.updateNodeState(runId, node.id, "success", input, output)
    return { [node.id]: output }
  }
}

private async callAgent(node: AgentNode, input: object, runId: string): Promise<object> {
  // Fetch fresh from Vault — never cached in graph state
  const apiKey = await vault.resolve(node.config.api_key_ref)
  const connectionToken = node.connection
    ? await connectionManager.getValidToken(node.connection)
    : null

  const tools = node.config.tools.length > 0
    ? await toolRegistry.getTools(node.config.tools, connectionToken)
    : []

  const response = await litellm.chat({
    model: node.config.model,
    api_key: apiKey,
    messages: [
      { role: "system", content: node.config.system_prompt },
      { role: "user", content: JSON.stringify(input) }
    ],
    tools,
    temperature: 0.2,
  })

  // apiKey and connectionToken go out of scope here — never stored
  return this.parseAgentOutput(response)
}
```

**Step executor** — runs deterministic logic (`transform`, `filter`, `branch`) with no external calls and no API keys.

### Data Mapping Resolution

```typescript
private resolveInput(node: Node, state: GraphState): object {
  const incomingEdges = schema.edges.filter(e => e.to === node.id)
  let resolved: object = {}

  for (const edge of incomingEdges) {
    const upstream = state[edge.from]
    if (!upstream) continue

    if (!edge.data_mapping) {
      resolved = { ...resolved, ...upstream }       // Pass through everything
    } else {
      for (const [sourceField, targetField] of Object.entries(edge.data_mapping)) {
        const value = getNestedField(upstream, sourceField)
        resolved = setNestedField(resolved, targetField, value)
      }
    }
  }

  return resolved
}
```

### Retry Logic

```typescript
private async executeWithRetry<T>(
  fn: () => Promise<T>,
  retry: RetryConfig,
  runId: string,
  nodeId: string
): Promise<T> {
  let lastError: Error | null = null

  for (let attempt = 1; attempt <= retry.max_attempts; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error
      await this.logNodeAttempt(runId, nodeId, attempt, error)
      if (attempt === retry.max_attempts) break

      const delay = {
        none:        0,
        linear:      retry.backoff_base_seconds * attempt * 1000,
        exponential: retry.backoff_base_seconds * Math.pow(2, attempt - 1) * 1000,
      }[retry.backoff]

      await sleep(delay)
    }
  }

  if (retry.fail_program_on_exhaust) {
    throw new NodeExecutionError("MAX_RETRIES_EXHAUSTED", lastError?.message, nodeId)
  } else {
    // Skip node and continue pipeline
    await this.updateNodeState(runId, nodeId, "skipped", null, null)
    return null as T
  }
}
```

### Human Approval Flow

When `requires_approval: true`, the run pauses:

1. Node status set to `waiting_approval`, run status set to `waiting_approval`
2. Supabase Realtime pushes update to visual editor (node pulses yellow)
3. Push notification sent to user
4. Runtime polls `node_run_states.approval_decision` every 5 seconds
5. User approves or rejects via the editor or mobile approval queue
6. On approval: run continues from this node
7. On rejection: node status → `skipped`, run continues (or fails, per config)
8. On timeout (`approval_timeout_hours` exceeded): run status → `failed`, error code `APPROVAL_TIMEOUT`

### Trigger Engine (Inngest)

Inngest fires runs based on trigger configurations. It handles scheduling, event subscriptions, and webhooks with retries and dead-letter queues built in.

| Trigger type | Inngest mechanism |
|---|---|
| `cron` | `{ cron: expression }` — registered dynamically per program |
| `event` | `{ event: "app/provider.event_name" }` — fired by connector webhooks |
| `webhook` | Edge function receives POST, calls `startRun()` |
| `manual` | API call from frontend → `startRun()` |
| `program_output` | End of every successful run sends `app/program.completed` event |

### Starting a Run

```typescript
async function startRun(
  programId: string,
  triggerType: string,
  triggerPayload: object
): Promise<string> {

  const program = await db.programs.findById(programId)
  if (!program.metadata.is_active) return null

  // Conflict check before acquiring resources
  const conflicts = await checkResourceConflicts(program)
  if (conflicts.length > 0) await handleConflicts(program, conflicts)

  const run = await db.runs.create({
    program_id: programId,
    user_id: program.user_id,
    status: "running",
    trigger_type: triggerType,
    trigger_payload: triggerPayload,
    started_at: new Date().toISOString(),
    execution_mode: program.schema.execution_mode,
    schema_version: getCurrentVersion(program.schema),
  })

  await db.nodeRunStates.createMany(
    program.schema.nodes.map(node => ({
      run_id: run.id, node_id: node.id, status: "idle", attempts: 0
    }))
  )

  const compiled = await executionEngine.compile(program.schema)

  // Fire-and-forget — return run ID immediately
  compiled
    .invoke({ [triggerNodeId]: triggerPayload }, { configurable: { runId: run.id } })
    .then(() => db.runs.update(run.id, { status: "success", completed_at: now() })
                  .then(() => inngest.send({ name: "app/program.completed", data: { run_id: run.id, program_id: programId } })))
    .catch(error => db.runs.update(run.id, { status: "failed", completed_at: now(), error }))

  return run.id
}
```

### Resource Conflict Handling

```typescript
async function checkResourceConflicts(program: Program): Promise<Conflict[]> {
  const runningPrograms = await db.runs.findActive(program.user_id)
  return runningPrograms.flatMap(running =>
    findSharedWriteConnections(program.schema, running.schema).length > 0
      ? [{ program_id: running.id, shared_connections: findSharedWriteConnections(...) }]
      : []
  )
}

// Per-program conflict policy (set in program settings)
switch (program.conflict_policy) {
  case "queue": await waitForConflictsToResolve(conflicts); break
  case "skip":  throw new RunSkippedError("Resource conflict")
  case "fail":  throw new RunFailedError("Resource conflict")
}
```

### Run Log (What the User Sees)

Every `updateNodeState` call writes to `node_run_states`. Supabase Realtime pushes to the editor. The run log panel shows a timeline:

```
RUN #47 — Started 14:32:01
─────────────────────────────────────────────
✅ New Email Arrives      14:32:01 → 14:32:02   1 email received
⚙️  Summarize Email       14:32:02 → 14:32:04   3 bullet points generated
⏳ Post to Notion         14:32:04 → waiting...  Approval needed ↓
```

Each row is expandable — user sees the full input and output payload for that node. This is the primary debugging surface. A failed run shows exactly what each node received and produced so the user can pinpoint which system prompt or data mapping to fix.

### Security Boundaries (Runtime-Specific)

- API keys fetched per-node-execution from Vault, discarded immediately after
- Connection tokens fetched via `getValidToken()` per node, never written to graph state
- Graph state persisted to DB (encrypted at rest via Supabase)
- RLS ensures no user's run state is accessible to another user
- LiteLLM proxy runs server-side — model API calls never originate from the frontend
- Tool calls scoped to the connection tokens provided — no scope elevation possible
- Each run executes in an isolated async context — no shared memory between concurrent runs

---

## 9. Connection / OAuth Manager Spec

This is the foundation everything else sits on. If connections are unreliable, scopes are wrong, or tokens expire silently, every Program built on top breaks in ways that are hard to trace.

### Core Concepts

**A connection is not the same as a credential.** A credential is the raw OAuth token or API key. A connection is the named, scoped, user-facing resource built on top of a credential. One credential can power multiple connections with different scope profiles — e.g. `gmail:primary` (read-only) and `gmail:sender` (send-only) both backed by the same Google OAuth token.

**Connections are global to the user, not to a Program.** The user manages connections in one place. Programs request access to named connections. Revoking a connection immediately affects every Program using it — which is the correct behavior.

**Scopes are requested at connection time, enforced at node time.** When the user connects Gmail they choose what permissions to grant. When a node needs write access, the validation layer checks whether the connection has that scope. No permission surprises mid-run.

### Data Model

```typescript
// Stored in Supabase DB — credential values never here, only refs

interface Connection {
  id: string;
  user_id: string;
  name: string;                      // e.g. "gmail:primary"
  display_name: string;              // e.g. "Personal Gmail (Read Only)"
  type: ConnectionType;
  auth_method: "oauth" | "api_key" | "basic";
  scopes: string[];                  // Granted scopes e.g. ["gmail.readonly"]
  status: ConnectionStatus;
  created_at: string;
  last_verified_at: string;
  last_used_at: string | null;
  metadata: ConnectionMetadata;
  credential_ref: string;            // References encrypted record in Vault — never sent to frontend
}

type ConnectionStatus = "active" | "expired" | "revoked" | "invalid" | "pending";

interface ConnectionMetadata {
  provider_account_id: string;
  provider_account_email: string;
  provider_account_name: string;
  avatar_url: string | null;
  token_expiry: string | null;       // ISO 8601, null if non-expiring
  refresh_token_available: boolean;
}

type ConnectionType =
  | "gmail" | "google_calendar" | "google_sheets" | "google_drive"
  | "notion" | "slack" | "github" | "shopify" | "airtable"
  | "twitter" | "linkedin" | "discord" | "telegram"
  | "stripe" | "hubspot" | "salesforce"
  | "webhook" | "api_key_generic"

// Stored in Supabase Vault — never in the main DB
interface EncryptedCredential {
  id: string;                        // = connection.credential_ref
  user_id: string;
  access_token: string;              // Encrypted at rest
  refresh_token: string | null;      // Encrypted at rest
  api_key: string | null;            // Encrypted at rest, for API key auth
  encryption_key_id: string;
}
```

### Frontend-Safe Projection

The frontend **never** sees tokens or `credential_ref`. All connection API responses return only:

```typescript
interface ConnectionView {
  id: string;
  name: string;
  display_name: string;
  type: ConnectionType;
  status: ConnectionStatus;
  scopes: string[];                  // Scope names only, not raw OAuth values
  metadata: {
    provider_account_email: string;
    provider_account_name: string;
    avatar_url: string | null;
    token_expiry: string | null;
  };
  created_at: string;
  last_verified_at: string;
  programs_using: number;            // Count shown before delete to warn user
}
```

### The OAuth Flow

```
User clicks "Connect Gmail"
    ↓
Backend generates CSRF state token
Stores state → { user_id, connection_name, requested_scopes } in Redis (TTL: 10 min)
    ↓
Backend builds OAuth URL:
  - client_id, redirect_uri, scope (joined scopes), state
  - access_type: "offline"   ← required to get refresh token
  - prompt: "consent"        ← forces refresh token even if previously granted
    ↓
Frontend redirects to OAuth URL
    ↓
User authenticates and grants permissions on provider
    ↓
Provider redirects to callback: ?code=...&state=...
    ↓
Backend validates state token (CSRF check)
Backend exchanges code → access_token + refresh_token
Backend verifies granted scopes ⊇ requested scopes
    ↓
Scope mismatch:
  → Error: "Required permissions were not granted"
  → Do not save — let user retry with explanation
    ↓
Scopes match:
  → Encrypt tokens → store in Vault
  → Create Connection record (status: "active")
  → Redirect to connections page
```

### The API Key Flow

```typescript
async function saveApiKeyConnection(
  userId: string, name: string, type: ConnectionType,
  apiKey: string, displayName: string
): Promise<Connection> {

  // Probe — make a minimal real API call to confirm key works
  const probeResult = await probeApiKey(type, apiKey)
  if (!probeResult.valid)
    throw new ConnectionError("INVALID_KEY", "This API key is not valid")

  const metadata = extractMetadata(type, probeResult.response)

  const credentialRef = await vault.store({
    user_id: userId, api_key: apiKey,
    access_token: null, refresh_token: null,
  })

  return await db.connections.create({
    user_id: userId, name, display_name: displayName, type,
    auth_method: "api_key",
    scopes: probeResult.available_scopes,
    status: "active",
    credential_ref: credentialRef,
    metadata,
    last_verified_at: new Date().toISOString(),
  })
}
```

### Token Refresh

Called by the runtime before every node that uses a connection. Never called by the frontend.

```typescript
async function getValidToken(connectionId: string): Promise<string> {
  const connection = await db.connections.findById(connectionId)
  const credential = await vault.get(connection.credential_ref)

  // Refresh if within 5 minutes of expiry
  const expiresAt = new Date(connection.metadata.token_expiry)
  if (expiresAt > new Date(Date.now() + 5 * 60 * 1000)) {
    return credential.access_token   // Still valid
  }

  if (!credential.refresh_token) {
    await db.connections.update(connectionId, { status: "expired" })
    await notifyUser(connection.user_id, "CONNECTION_EXPIRED", connection.name)
    throw new ConnectionError("TOKEN_EXPIRED",
      `${connection.display_name} needs to be reconnected`)
  }

  const refreshed = await refreshOAuthToken(connection.type, credential.refresh_token)

  await vault.update(connection.credential_ref, {
    access_token: refreshed.access_token,
    refresh_token: refreshed.refresh_token ?? credential.refresh_token,
  })

  await db.connections.update(connectionId, {
    metadata: { ...connection.metadata, token_expiry: refreshed.expiry },
    last_verified_at: new Date().toISOString(),
  })

  return refreshed.access_token
}
```

### Background Health Monitor

Runs every 6 hours via Inngest across all active connections. Users learn about expired connections proactively, not when a Program fails at 3am.

```typescript
async function monitorConnectionHealth(): Promise<void> {
  const active = await db.connections.findAll({ status: "active" })

  await Promise.allSettled(active.map(async connection => {
    try {
      await getValidToken(connection.id)
      await db.connections.update(connection.id, {
        last_verified_at: new Date().toISOString()
      })
    } catch (error) {
      if (error.code === "TOKEN_REVOKED") {
        await db.connections.update(connection.id, { status: "revoked" })
        await notifyUser(connection.user_id, "CONNECTION_REVOKED", connection.name)
      }
      // TOKEN_EXPIRED already handled inside getValidToken
    }
  }))
}
```

### Scope Registry

Static map of provider scopes — drives both OAuth requests and scope checking in the validation layer. Shown to users as checkboxes with human-readable labels, never as raw OAuth strings.

```typescript
// packages/connectors-shared/scopes.ts
const PROVIDER_SCOPES = {
  gmail: {
    "gmail.readonly": {
      label: "Read emails",
      oauth_value: "https://www.googleapis.com/auth/gmail.readonly",
      access_type: "read",
    },
    "gmail.send": {
      label: "Send emails",
      oauth_value: "https://www.googleapis.com/auth/gmail.send",
      access_type: "write",
    },
    "gmail.modify": {
      label: "Read and modify emails",
      oauth_value: "https://www.googleapis.com/auth/gmail.modify",
      access_type: "read_write",
    },
  },
  notion: {
    "notion.read":  { label: "Read pages and databases", oauth_value: "read_content",   access_type: "read" },
    "notion.write": { label: "Create and edit pages",    oauth_value: "update_content",  access_type: "write" },
  },
  github: {
    "github.repo.read":  { label: "Read repositories",           oauth_value: "repo:read", access_type: "read" },
    "github.repo.write": { label: "Read and write repositories", oauth_value: "repo",      access_type: "read_write" },
    "github.issues":     { label: "Manage issues",               oauth_value: "issues",    access_type: "read_write" },
  },
  // ... all providers
}
```

### Connection Deletion Rules

```typescript
async function deleteConnection(connectionId: string, userId: string): Promise<void> {
  const programsUsing = await db.programs.findByConnection(connectionId)

  if (programsUsing.length > 0) {
    throw new ConnectionError(
      "CONNECTION_IN_USE",
      `Used by ${programsUsing.length} program(s): ${programsUsing.map(p => p.program_name).join(", ")}. Remove it from those programs first.`
    )
  }

  const connection = await db.connections.findById(connectionId)
  await vault.delete(connection.credential_ref)  // Purge from Vault first
  await db.connections.delete(connectionId)
}
```

Silently deleting a connection programs depend on causes runtime failures that are nearly impossible to trace. Hard block it.

### Security Rules (Non-Negotiable)

- Tokens are **never** returned to the frontend under any circumstance
- Tokens are **never** logged — add a log scrubber middleware that redacts strings matching OAuth token patterns
- All credential access goes through `getValidToken()` — nothing reads from Vault directly except that function
- `credential_ref` is **never** included in any frontend-facing API response
- Connection deletion requires the credential to be purged from Vault, not just the DB record
- Re-authentication always generates a new credential record — old one deleted after successful replacement

---

## Phase 0: Foundation (Week 1–2)

**Goal:** Monorepo, auth, DB, staging deploy.

### Week 1
- [x] Init monorepo with pnpm + Turborepo
- [x] Create `apps/web` (Next.js 14, App Router, Tailwind, shadcn/ui)
- [x] Create `packages/schema` with all types + Zod validators
- [x] Create `packages/db` (Supabase client, typed)
- [x] Set up Supabase project (local dev + hosted)
- [x] Configure `.env.example` and all environment variables

### Week 2
- [x] Write and apply all DB migrations from Section 4
- [x] Set up RLS policies
- [x] Configure Supabase Auth (email/password + Google OAuth)
- [x] Build auth pages: login, signup, forgot password, OAuth callback
- [x] Create Next.js middleware for protected routes
- [x] Run `supabase gen types` and wire into `packages/db`
- [ ] Deploy staging to Vercel

**Milestone:** Login → dashboard, all tables exist with RLS.

---

## Phase 1: Genesis & Validation (Week 3–5)

**Goal:** API key management, connection manager (Gmail OAuth), program genesis, schema validation.

### Week 3 — API Key Management
- [x] Build API key management UI (add, list, delete, validate)
- [x] Implement Supabase Vault write/read for key storage
- [ ] Build server-side LiteLLM proxy (`/api/models/invoke` — key never leaves server) ← skipped; runtime calls providers directly (OpenRouter/Anthropic/OpenAI)
- [x] Key validation endpoint (calls provider, returns valid/invalid + quota status)
- [x] Test with Anthropic, OpenAI, OpenRouter

### Week 4 — Connection Manager
- [ ] Define `IConnector` interface (`packages/connectors-shared/base.ts`) ← skipped for now; OAuth only, no operation layer yet
- [x] Implement Gmail OAuth connector (first full implementation)
- [x] OAuth callback → store tokens in Vault → create `connections` row
- [x] Connection management UI (list, add, test, remove) — includes logos
- [x] Token refresh flow for expiring OAuth tokens (`lib/oauth-token.ts` + `/api/internal/connections/[id]/token`)
- [x] Connection test endpoint (live ping against provider)

### Week 5 — Program Genesis

**Genesis is the most critical single flow in the product.** The prompt must be deterministic enough to produce valid JSON every time, flexible enough to handle any user description.

#### Genesis System Prompt

Stored server-side in `apps/web/lib/genesis/prompt.ts`. Never sent to the client.

```
You are an AI system architect. Your job is to convert a user's natural 
language description of an automation or agent workflow into a precise, 
executable graph schema in JSON.

You will be given:
1. A user description of what they want to build
2. A list of connected apps/services available to this program

Your output must be a single valid JSON object. No explanation, no markdown, 
no code fences. Only the raw JSON object.

The JSON must follow this exact structure:

{
  "version": "1.0",
  "program_id": "__GENERATED__",
  "nodes": [...],
  "edges": [...],
  "triggers": [...],
  "execution_mode": "autonomous" | "supervised" | "approval_required",
  "version_history": []
}

NODE RULES:
- Every node must have: id (string, unique), type, label, connection, config, position
- type must be one of: "trigger", "agent", "step", "connection"
- connection must be exactly one of the provided connection names, or null
- position values must be spaced at least 300px apart horizontally
- Every graph must have exactly one trigger node
- Agent nodes must include: model (leave as "__USER_ASSIGNED__"), 
  api_key_ref (leave as "__USER_ASSIGNED__"), system_prompt, 
  requires_approval (boolean), retry object
- Step nodes must include: logic_type ("transform" | "filter" | "branch"), 
  description of what the step does
- Maximum 12 nodes for any single program

EDGE RULES:
- Every edge must have: id, from, to, type
- type must be one of: "data_flow", "control_flow", "event_subscription"
- No circular edges unless a step node of logic_type "branch" is involved
- Every node except the trigger must have at least one incoming edge
- Every node except terminal nodes must have at least one outgoing edge

TRIGGER RULES:
- type must be one of: "cron", "event", "webhook", "manual", "program_output"
- cron triggers must include a valid cron expression
- event triggers must include source (connection name) and event name
- webhook triggers must include an endpoint placeholder

EXECUTION MODE RULES:
- Use "autonomous" if the workflow is fully automated with no human decisions
- Use "approval_required" if any node has requires_approval: true
- Use "supervised" only if the user explicitly asks for manual control

VALIDATION SELF-CHECK:
Before outputting, verify:
1. Every edge references valid node ids
2. Every connection reference matches the provided connection list
3. No node is isolated (has no edges)
4. There is exactly one trigger node
5. Node count does not exceed 12

If the user description is too vague to produce a valid graph, output:
{
  "error": "INSUFFICIENT_DESCRIPTION",
  "message": "A one sentence explanation of what information is missing"
}

If the user description requires connections not in the provided list, output:
{
  "error": "MISSING_CONNECTIONS",
  "missing": ["connection_name_1", "connection_name_2"],
  "message": "These connections are required but not available in this program"
}
```

#### Genesis User Message (assembled by backend)

```
User description:
"${userDescription}"

Available connections for this program:
${JSON.stringify(availableConnections, null, 2)}

Generate the graph schema now.
```

`availableConnections` is assembled from the connections the user selected at Program creation:

```json
[
  { "name": "gmail:primary", "type": "gmail", "scopes": ["gmail.readonly", "gmail.send"] },
  { "name": "notion:workspace", "type": "notion", "scopes": ["notion.read", "notion.write"] }
]
```

#### Model Call Settings

Always call genesis with:
- `temperature: 0` — deterministic structured output, not creativity
- `max_tokens: 2000` — sufficient for a 12-node graph with full config
- JSON mode / structured outputs enabled if the provider supports it

#### Error State Handling

| Error | UI Response |
|---|---|
| `INSUFFICIENT_DESCRIPTION` | Show friendly prompt asking for more detail. Pre-fill original description — do not clear the form. |
| `MISSING_CONNECTIONS` | List which connections are missing with a direct link to add them. Do not discard the description. |
| Malformed JSON (model failure) | Retry once with the parse error appended to the prompt as feedback. If still malformed, show "Generation failed — try again or use a template." |

#### Why the Self-Check Matters

LLMs occasionally produce edges referencing non-existent node IDs or orphan nodes, especially on complex descriptions. Asking the model to self-check before outputting catches ~70% of these before they reach the validation layer. The validation layer (Section C) catches the rest. Defense in depth.

#### Implementation Tasks

- [x] Program creation UI (name, description, select allowed connections)
- [x] Genesis prompt + user message templates in `apps/web/lib/genesis/prompt.ts`
- [x] Genesis API route (`POST /api/genesis`): description + connections → AI → parse → validate
- [x] Handle `INSUFFICIENT_DESCRIPTION` and `MISSING_CONNECTIONS` error responses in UI
- [x] Parse and forward to schema validation engine on success
- [x] Store genesis output as version 0 in `program_versions`
- [x] Validation error display (inline indicators — full UI in Phase 2 editor)

**Milestone:** User describes a program, AI returns valid schema (or a specific, actionable error), errors surfaced before the editor loads.

---

## Phase 2: Visual Editor (Week 6–9)

**Goal:** Full React Flow editor with schema roundtrip, node config sidebar, versioning.

### Week 6 — React Flow + Translation Layer
- [x] Install and configure React Flow with custom theme
- [x] Implement `canonicalToReactFlow()` translator (`toReactFlow`)
- [x] Implement `reactFlowToCanonical()` translator (`fromReactFlow`)
- [x] Roundtrip test: schema → RF → schema must be byte-identical (17 tests covering all node/edge types, sentinels, versioning, metadata — all passing)
- [x] Build custom node components: TriggerNode, AgentNode, StepNode, ConnectionNode
- [x] Render validation errors as red node borders with tooltips

### Week 7 — Editor Interactions
- [x] Node add (toolbar buttons), remove (sidebar delete + Delete key)
- [x] Edge add (connect handles), remove, rewire
- [x] Selection
- [x] Copy/paste nodes
- [x] Minimap and zoom controls
- [x] Auto-layout (dagre) for freshly generated schemas (`lib/schema/layout.ts`, applied in EditorShell on load)

### Week 8 — Node Configuration Sidebar
- [x] Sidebar panel opens on node click
- [x] AgentNode: model dropdown (from user's API keys), system prompt textarea, requires_approval toggle, retry config
- [x] TriggerNode: event selector, scope display
- [x] StepNode: operation type, expression editor
- [x] ConnectionNode: connection selector, operation, scope (read/write)
- [x] Sidebar changes update canonical schema immediately

### Week 9 — Versioning, Auto-save, Mobile
- [x] Auto-save with 2-second debounce (schema diff → only save if changed)
- [x] Version history storage on every manual save
- [x] Version history UI: list versions, preview schema diff, rollback button
- [x] "Reset to genesis" shortcut (roll back to version 0)
- [x] Keyboard shortcuts (delete node, undo/redo, Cmd+S save)
- [x] Mobile mode: editor is read-only, all controls hidden, status badges visible (isMobile check in EditorShell)

**Milestone:** Full visual editing with roundtrip fidelity, versioning, mobile fallback.

---

## Phase 3: Runtime Engine (Week 10–13)

**Goal:** Python LangGraph runtime, execution, live run logs, human approval.

### Week 10 — Python Runtime Setup
- [x] Create `apps/runtime` with FastAPI + Poetry
- [x] LangGraph environment setup
- [x] Schema parser: `ProgramSchema` JSON → execution graph
- [x] Basic `/execute` endpoint (accepts run_id + schema, starts execution)
- [ ] Deploy to Railway, configure env vars ← running locally; Railway deploy pending
- [x] Internal auth between Next.js → Runtime (shared secret via `x-runtime-secret`)

### Week 11 — Node Executors
- [x] `TriggerNodeExecutor` — receives trigger payload, passes to next node
- [x] `AgentNodeExecutor` — retrieves API key from vault endpoint, calls OpenRouter/Anthropic/OpenAI
- [x] `StepNodeExecutor` — runs deterministic operations (transform, filter, branch)
- [x] `ConnectionNodeExecutor` — HTTP connector (generic); native connector ops not yet wired
- [x] Edge routing: data_flow passes output as next input; topological execution
- [x] Retry logic with exponential/linear/none backoff per node config

### Week 12 — Run Logging & Live Updates
- [x] Write run + node_execution rows as execution progresses
- [x] Supabase Realtime subscription in frontend + 2s polling fallback
- [x] Node status states: pending, running, completed, failed, waiting_approval, skipped
- [x] Run log timeline UI (per-node entries with timestamps, status, payloads)
- [x] Input/output payload inspector (expandable JSON viewer per node execution)
- [x] Global Runs page (all programs, active + history, status filters, force stop)
- [x] Dead-letter queue / in-app notification for failed runs (sidebar badge via `/api/runs/failed-count`, 7-day window)

### Week 13 — Human Approval Flow
- [x] AgentNode with `requires_approval: true` pauses execution, creates `approvals` row
- [x] Approval queue page (lists pending approvals with context)
- [x] Approve/reject UI with optional decision note
- [x] On approval: runtime polls and resumes execution
- [x] On rejection: node moves to `skipped`, run continues per config
- [x] In-app notification badge for pending approvals (sidebar badge via `/api/approvals`)

**Milestone:** Programs execute end-to-end with live status, retry, and human approval.

---

## Phase 4: Triggers & Execution Controls (Week 14–15)

**Goal:** All trigger types, inter-program triggers, conflict detection.

### Week 14 — Trigger Engine
- [x] Manual trigger (Run button in editor → POST to `/api/runs`)
- [x] Cron trigger via APScheduler (loaded at runtime startup from schema JSON) ← Inngest not used
- [x] Inbound webhook trigger (`/api/triggers/webhook/[token]`, unique opaque token per trigger)
- [x] Event trigger (`/api/triggers/event` — matches source+event, fires all matching programs)
- [x] Inter-program trigger (runtime calls `/api/internal/runs/[id]/complete` after each run; fires downstream `program_output` triggers)
- [x] Trigger management UI (`/programs/[id]/triggers` — list, add, enable/disable, delete, copy webhook URL)

### Week 15 — Conflict Detection & Execution Controls
- [x] Resource locking: acquire lock on write-access connections at run start
- [x] Lock expiry + cleanup (stale lock detection via `cleanup_stale_locks`)
- [x] Editor warning: two Programs with write access to same connection (WARN_003 in `validatePostGenesis`)
- [x] Conflict resolution UI: queue / skip / fail policy per Program (`/programs/[id]/conflicts`)
- [x] Run cancellation (force stop button, marks cancelled, releases locks)
- [x] Execution mode switcher UI (autonomous / supervised / manual) (`ExecutionControls` on program detail page)

**Milestone:** All 5 trigger types working, conflict detection active.

---

## Phase 5: Native Connectors (Week 16–19)

**Goal:** Full native connector library for Gmail, Notion, Slack, GitHub, Google Sheets.

Each connector implements `IConnector`:
```typescript
interface IConnector {
  provider: string;
  authType: 'oauth' | 'api_key';
  operations: ConnectorOperation[];
  authenticate(credentials: Credentials): Promise<boolean>;
  execute(operation: string, params: Record<string, unknown>, credentials: Credentials): Promise<unknown>;
  getWebhookEvents?(): string[];
  handleWebhook?(payload: unknown): ConnectorEvent;
}
```

### Week 16 — Gmail (deepen from Phase 1 stub)
- [x] OAuth flow complete (scopes: readonly, send, modify)
- [ ] Full operation set: read_email, send_email, list_threads, search, label, archive ← not yet
- [ ] Push notifications via Gmail watch API ← not yet
- [ ] Attachment handling ← not yet
- [ ] Rate limiting wrapper ← not yet

### Week 17 — Notion
- [x] OAuth flow + token storage (Basic auth token exchange)
- [ ] Operations: read_page, append_to_page, create_page, create_database_entry, query_database ← not yet

### Week 18 — Slack + GitHub
- [x] **Slack:** OAuth flow complete
- [ ] **Slack:** send_message, read_channel, create_channel, Event API webhooks ← not yet
- [x] **GitHub:** OAuth flow complete
- [ ] **GitHub:** create_issue, comment, list_prs, push_file, webhook events ← not yet

### Week 18b — Additional OAuth flows (added beyond original plan)
- [x] Airtable OAuth (PKCE flow)
- [x] HubSpot OAuth
- [x] Asana OAuth
- [x] Microsoft Outlook OAuth
- [x] Typeform OAuth
- [x] Google Sheets / Calendar / Docs / Drive OAuth (shared Google handler)

### Week 19 — Google Sheets
- [x] OAuth (shares Google consent screen — single handler for all Google services)
- [ ] Operations: read_range, write_range, append_row, create_sheet, clear_range
- [ ] Change detection via Sheets push notifications

**Milestone:** 5 connectors fully operational, all integrated with connection manager.

---

## Phase 6: Pre-flight & Polish (Week 20–22)

**Goal:** Pre-flight check system, dry-run simulation, PWA, billing, end-to-end QA.

### Week 20 — Pre-flight Check System
- [x] Implement `validatePreFlight()`: PRE_001–PRE_004 checks, runs before every execution
- [x] Block execution (`Run` button disabled / 422 returned) if any PRE_* errors present
- [ ] Pre-flight results UI: checklist mapping each PRE_* rule to green tick / red failure ← errors shown inline but no dedicated checklist UI
- [ ] `fix_suggestion` deep links from each failure to the relevant settings page ← not yet

### Week 21 — PWA + Billing

**Free tier limits:** 2 active Programs, 50 executions/month, 3 connections. Paid tiers unlock more of each.

- [ ] Configure `next-pwa` (manifest, service worker, offline shell)
- [ ] PWA install prompt
- [ ] Push notification support (for approval requests)
- [ ] Usage tracking (increment counters on run completion)
- [ ] Tier enforcement: hard-limit check before `startRun()` — reject with clear error if limit exceeded
- [ ] Upgrade prompt UI when limits hit
- [ ] Stripe integration for Pro tier (webhook → update `profiles.tier`)

### Week 22 — End-to-End QA
- [ ] E2E test suite: Gmail → Summarize → Notion (canonical test program)
- [ ] E2E test suite: GitHub PR event → Slack notification
- [ ] Load test: 10 concurrent program executions
- [ ] Security audit: no keys in logs, no keys in frontend network calls
- [ ] Mobile QA: all read-only flows work on iOS Safari + Android Chrome
- [ ] Performance: editor loads < 2s for 50-node programs

**Milestone:** Production-ready MVP, PWA installable, billing active.

---

## Testing Strategy

### Unit Tests (vitest)
- Schema translation roundtrip (`canonicalToReactFlow` ↔ `reactFlowToCanonical`)
- Schema validation engine (each validation rule independently)
- Zod validators (edge cases, invalid inputs)
- All connector operation handlers

### Integration Tests
- Genesis flow: description → AI → schema → validation → DB
- Full execution: trigger → node chain → run log written correctly
- Approval flow: pause → approve → resume
- Vault: key stored → retrieved server-side → never in response body

### E2E Tests (Playwright)
- Auth flow (signup → login → protected route)
- Program genesis → editor renders
- Visual editor changes persist on reload
- Manual trigger → run log shows node statuses
- Approval queue → approve → execution continues

---

## Deployment Checklist

### Vercel (Next.js)
- [ ] Environment variables set (Supabase URL/anon key, Runtime URL, internal auth secret)
- [ ] Edge middleware configured for auth
- [ ] `next-pwa` build verified
- [ ] Preview deployments on PRs

### Railway (Python Runtime)
- [ ] Environment variables set (Supabase service role key, LiteLLM config, Inngest key)
- [ ] Health check endpoint `/health`
- [ ] Auto-restart on crash
- [ ] Resource limits configured (prevent runaway executions)

### Supabase
- [ ] Production project separate from dev
- [ ] Vault enabled
- [ ] Realtime enabled for `runs` and `node_executions` tables
- [ ] Backups enabled
- [ ] Rate limiting configured

---

## Program Dashboard

After setup and after every subsequent visit, the user lands on the program dashboard. This is the most-visited screen — treat it as the home of each program, not an afterthought.

### Dashboard Contents

- Program name + description
- Active / Inactive toggle (activates/deactivates all triggers for this program)
- **Run Now** button (manual trigger)
- **Stop** button (shown only when a run is in progress)
- Last run status badge: Success / Failed / Running / Waiting Approval
- Last run timestamp
- Next scheduled run (for cron triggers)
- Quick link → Graph Editor
- Run history list (last 20 runs — status, timestamp, duration per row)
- Click any run row → full run log with per-node details
- Trigger status section (which triggers are active, last fired, next scheduled)
- Connected apps used by this program (list with live status indicators)

---

## Known Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Genesis produces invalid graph | Self-check instruction in prompt + post-genesis validation layer catches structural errors before user sees diagram |
| React Flow / LangGraph schema drift | Single canonical schema, dedicated translation functions, both sides are translation layers only |
| No execution sandbox | Per-node permission scoping, dry-run pre-flight, rate limiting per connection |
| BYOK API key security | Supabase Vault, never logged, never sent to frontend, always proxied via LiteLLM, referenced by ID only |
| Concurrent program conflicts | Resource locking on write-access connections, configurable `conflict_policy` per program |
| OAuth token expiry mid-run | `getValidToken()` auto-refreshes within 5-min window, background monitor catches expiry proactively, user notified before failure |
| Composio dependency | All connector calls behind `IConnector` abstraction, swappable per connector. Native fallback priority: Gmail, Notion, Slack, GitHub, Google Sheets |
| Mobile editing pain | Diagram read-only on mobile, full editing desktop only, communicated clearly in UI |
| Agent email deliverability | Phase 2 concern — requires SPF/DKIM/DMARC and warm sending reputation |

---

## What Not To Build (MVP Scope Guard)

The following are explicitly out of scope for MVP. Do not implement them:

- Multi-user workspaces or team features
- Native mobile app (PWA only for MVP)
- Crypto payments or wallets
- Agent email addresses
- Template marketplace
- Custom connector builder
- White-label or embedding
- Enterprise SSO
- Analytics dashboard

If a feature is not in the build order above, it is not in scope. Ship the 22-week plan first.

---

## Coding Standards

- TypeScript strict mode everywhere. No `any`.
- All DB access through typed Supabase client with RLS enforced.
- No secrets in environment variables on the frontend — backend only.
- All API routes validate and sanitize input before processing.
- All external API calls (model providers, app connectors) go through server-side routes only.
- Log scrubber middleware active on all backend routes before any logging.
- Every function that touches credentials must have a unit test.
- Translation functions (`toReactFlow`, `fromReactFlow`, `toLangGraph`) must have exhaustive tests covering every node type, edge type, and sentinel value scenario.
- React Flow editor dispatches actions only — never mutates schema directly.
- Supabase Realtime used for all live updates — no polling anywhere in the codebase.

---

## Phase 2 Post-MVP Preparation

These are not built in MVP but the codebase must not prevent them.

| Feature | Pre-condition to maintain now |
|---|---|
| Multi-tenancy / Teams | `org_id` on all user tables (nullable, set in Phase 2) |
| Crypto wallets (AgentKit) | Agent node config has extensible `tools[]` array |
| x402 micropayments | LiteLLM proxy is the single model call point — billing hooks go there |
| Agent email identity | Connection type "email" reserved in connector registry |
| Template marketplace | `programs.is_public` column added at Phase 2, schema already serializable |
| Native connector expansion | All connectors implement `IConnector` — new ones drop in |
| React Native mobile app | Once PWA is validated with real users — not before |

---

*Last updated: 2026-04-05*
