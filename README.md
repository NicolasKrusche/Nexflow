# Nexflow

Visual Agentic Operating System.

Nexflow lets users describe an automation in natural language, generate a graph-based agent workflow, edit it visually, validate it, and run it with secure server-side credentials.

## Test account

```
Email:    demo@nexflow.systems
Password: Nexflow2025!
```

Use these credentials at `/login` to access the app without creating an account.

## What this repository contains

This is a pnpm + Turborepo monorepo with four main areas:

- apps/web: Next.js 14 frontend and API routes (editor, programs, keys, connections, approvals, runs)
- apps/runtime: Python FastAPI runtime for graph execution
- packages/schema: Canonical schema types and validators shared across apps
- packages/db: Typed Supabase client and generated database types

## Core architecture

Nexflow is schema-first.

- The canonical schema is the source of truth.
- React Flow in the web app is a translation layer for editing.
- LangGraph in the runtime is a translation layer for execution.
- Validation gates are enforced before save/run.

Design intent:

- Fail early and explicitly on invalid workflows
- Keep credentials server-side only
- Keep editor and runtime loosely coupled through shared schema contracts

## Tech stack

- Frontend: Next.js 14 App Router, Tailwind, shadcn/ui, React Flow
- Runtime: Python, FastAPI, LangGraph
- Data/Auth: Supabase (Postgres, Auth, RLS, Realtime, Vault)
- Model routing: LiteLLM proxy
- Triggering: Inngest
- Tooling: pnpm, Turborepo, TypeScript strict mode

## How the product flows

1. User describes an automation.
2. Genesis creates an initial canonical schema.
3. Post-genesis validation checks schema constraints.
4. User edits the graph in the visual editor.
5. Schema is saved and versioned.
6. Pre-flight checks validate live dependencies (keys, scopes, connections).
7. Runtime executes nodes and streams live state.

## Local development

Requirements:

- Node.js 20+
- pnpm 9+
- Supabase CLI
- Docker Desktop

Install and run:

1. Install dependencies:
   pnpm install
2. Follow setup instructions in SETUP.md for environment variables and Supabase.
3. Start all services:
   pnpm dev

## Monorepo scripts

Run from repository root:

- pnpm dev: start workspace dev servers
- pnpm build: build all packages/apps
- pnpm lint: run lint across workspace
- pnpm type-check: run type checking across workspace
- pnpm clean: clean workspace build artifacts

## Current status

The project is being built in phased delivery (foundation, genesis/validation, editor, runtime, triggers, connectors, polish). See plan.md for the full implementation roadmap.

## Documentation

- plan.md: implementation plan and phased roadmap
- SETUP.md: local environment and Supabase setup
- CLAUDE.md: product constraints, architecture principles, and coding rules
- apps/runtime/README.md: runtime-specific notes

## License

See LICENSE for terms.
