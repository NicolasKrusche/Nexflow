# FlowOS — Claude Code Instructions

> Visual Agentic Operating System: user describes automation → AI designs the graph → user tunes it visually → it runs itself.

---

## Project Overview

FlowOS lets users build AI agent pipelines visually. The canonical JSON schema is the heart of the product — React Flow and LangGraph are both just translation layers on top of it.

**Monorepo structure:**
- `apps/web` — Next.js 14 App Router + Tailwind (→ Vercel)
- `apps/runtime` — Python FastAPI + LangGraph (→ Railway)
- `packages/schema` — Canonical types + Zod validators (shared TS)
- `packages/db` — Supabase client + generated types

**Run dev:** `pnpm dev` (Turborepo runs all packages)

---

## Tech Stack

| Layer | Choice |
|---|---|
| Frontend | Next.js 14 App Router, Tailwind, shadcn/ui |
| Visual editor | React Flow |
| Runtime | LangGraph (Python, Railway) |
| Auth + DB | Supabase (RLS, Vault, Realtime) |
| Model routing | LiteLLM (self-hosted Railway) |
| Triggers | Inngest |
| Monorepo | pnpm + Turborepo |

---

## Core Principles

1. **Schema-first** — The canonical schema in `packages/schema/types.ts` is the contract. Never design around React Flow or LangGraph — both are adapters.
2. **Fail loudly, early** — Validation errors surface before execution, never swallowed silently.
3. **Server-side secrets only** — API keys and OAuth tokens never touch the frontend or logs. Ever.
4. **Multi-tenancy ready** — `org_id` on every user-scoped table (nullable for now, reserved for Phase 2 teams).
5. **Translation layers only** — `toReactFlow`, `fromReactFlow`, `toLangGraph` are the only things that know about RF/LG internals.

---

## The Canonical Schema

The most important engineering artifact. Every part of the system is a consumer of this schema.

**Key invariant:** `fromReactFlow(toReactFlow(schema), existing)` must deep-equal the original schema. Any deviation is a silent data loss bug — test this exhaustively.

**Sentinel values:** Genesis uses `"__USER_ASSIGNED__"` for `model` and `api_key_ref` on agent nodes. These are explicit incomplete-state markers, not nulls.

**Node types:** `trigger` | `agent` | `step` | `connection`
**Edge types:** `data_flow` | `control_flow` | `event_subscription`

Step nodes have `connection: null` — enforced, never optional.
Trigger nodes are source-only (no incoming handles).
Maximum 12 nodes per program.

---

## Validation Layer

Two passes, same result shape (`ValidationResult`):

- **Post-genesis** — synchronous, schema-only, runs before user sees the graph (ERR_001–ERR_012, WARN_001–003)
- **Pre-flight** — async, live checks (OAuth validity, API key probe, scope checks), runs before execution (PRE_001–004)

**Key rule:** The Run button is disabled when `ValidationResult.valid === false`. Never bypass this.

Node visual states driven by validation: red border = error, yellow = warning, dashed = unassigned, green = valid.

---

## Security Rules (Non-Negotiable)

- Tokens are **never** returned to the frontend
- Tokens are **never** logged — log scrubber middleware must redact OAuth token patterns
- All credential access goes through `getValidToken()` only
- `credential_ref` / `vault_secret_id` are **never** in any frontend-facing API response
- All model calls go through the LiteLLM proxy — never directly from frontend
- Connection deletion must purge from Vault, not just the DB row

---

## Editor Architecture

The editor is a controlled component — it never mutates schema directly. Every change dispatches through `useEditorReducer` → new schema version.

**Save flow:** `fromReactFlow` → `validatePostGenesis` → persist to DB (only if valid, or user force-saves with warnings)
**Load flow:** fetch from DB → `toReactFlow` → render

Auto-save: 2-second debounce, only if schema actually changed.
Undo stack: last 20 states in local `history[]`.

Live run visualization via Supabase Realtime on `node_executions` — no polling anywhere.

---

## Runtime Principles

- Stateless between nodes — all state lives in the database
- Resumable — runtime picks up from last checkpoint on crash
- Secrets never held in graph state — fetched fresh from Vault per node, discarded immediately after
- Resource locking on write-access connections prevents concurrent program conflicts

---

## Coding Standards

- TypeScript strict mode everywhere — **no `any`**
- All DB access through typed Supabase client with RLS enforced
- No secrets in frontend env vars — backend only
- All API routes validate and sanitize input before processing
- All external API calls (models, connectors) go through server-side routes only
- Every function that touches credentials must have a unit test
- Translation functions (`toReactFlow`, `fromReactFlow`, `toLangGraph`) must have exhaustive tests covering every node type, edge type, and sentinel value
- Supabase Realtime for all live updates — **no polling anywhere in the codebase**
- React Flow editor dispatches actions only — never mutates schema directly

---

## What NOT to Build (MVP Scope Guard)

Do not implement any of the following — they are explicitly out of scope:

- Multi-user workspaces or team features
- Native mobile app (PWA only)
- Crypto payments / wallets
- Agent email addresses
- Template marketplace
- Custom connector builder
- White-label / embedding
- Enterprise SSO
- Analytics dashboard

If a feature isn't in the 22-week plan, it doesn't ship in MVP.

---

## Current Build Phase

**Phase 0 (Week 1–2):** Monorepo, auth, DB, staging deploy
**Phase 1 (Week 3–5):** API key management, Gmail OAuth connector, program genesis, schema validation
**Phase 2 (Week 6–9):** Visual editor (React Flow), roundtrip translation, node sidebar, versioning
**Phase 3 (Week 10–13):** Python runtime, LangGraph execution, live run logs, human approval flow
**Phase 4 (Week 14–15):** All trigger types, conflict detection
**Phase 5 (Week 16–19):** Native connectors (Gmail, Notion, Slack, GitHub, Sheets)
**Phase 6 (Week 20–22):** Pre-flight checks, PWA, billing, QA

---

## Post-MVP Hooks to Preserve

Do not build these, but don't make them impossible either:

- `org_id` nullable on all user tables (multi-tenancy)
- `tools[]` array extensible on agent nodes (AgentKit, MCP)
- LiteLLM proxy is the single model call point (billing hooks go there)
- All connectors implement `IConnector` (new ones drop in)
- `programs.is_public` reserved for template marketplace

---

*Based on plan.md — last updated 2026-04-05*
