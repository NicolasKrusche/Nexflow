"use client";

import React, { useReducer, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
  type NodeChange,
  type EdgeChange,
  type Connection,
  type Node as ReactFlowNode,
  type Edge as ReactFlowEdge,
  MarkerType,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { editorReducer, initialEditorState } from "@/lib/editor/state";
import { toReactFlow, fromReactFlow } from "@/lib/schema";
import { applyDagreLayout, needsLayout } from "@/lib/schema/layout";
import { validatePostGenesis } from "@/lib/validation";

import { TriggerNode } from "@/components/nodes/TriggerNode";
import { AgentNode } from "@/components/nodes/AgentNode";
import { StepNode } from "@/components/nodes/StepNode";
import { ConnectionNode } from "@/components/nodes/ConnectionNode";
import { DataFlowEdge } from "@/components/edges/DataFlowEdge";
import { ControlFlowEdge } from "@/components/edges/ControlFlowEdge";
import { EventEdge } from "@/components/edges/EventEdge";
import { EditorToolbar } from "@/components/editor/EditorToolbar";
import { VersionHistoryPanel } from "@/components/editor/VersionHistoryPanel";
import { NodeSidebar } from "@/components/sidebars/NodeSidebar";
import type { ApiKey } from "@/components/sidebars/NodeSidebar";
import { NodePalettePanel } from "@/components/editor/NodePalettePanel";
import type { NodeVariant } from "@/components/editor/NodePalettePanel";

import type { ProgramSchema, Node as SchemaNode } from "@flowos/schema";
import type { ValidationResult } from "@/lib/validation";
import { createBrowserClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { PreFlightCheck } from "@/lib/validation/pre-flight";

// ─── Node execution data (populated from API + Realtime) ─────────────────────

export interface NodeExecutionData {
  status: SchemaNode["status"];
  input_payload: unknown;
  output_payload: unknown;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
}

// ─── Custom node/edge type registrations ─────────────────────────────────────

const nodeTypes = {
  trigger: TriggerNode,
  agent: AgentNode,
  step: StepNode,
  connection: ConnectionNode,
} as const;

const edgeTypes = {
  data_flow: DataFlowEdge,
  control_flow: ControlFlowEdge,
  event_subscription: EventEdge,
} as const;

// ─── Default node configs for new nodes ──────────────────────────────────────

const OAUTH_PROVIDER_LABELS: Record<string, string> = {
  gmail: "Gmail", notion: "Notion", slack: "Slack", github: "GitHub",
  sheets: "Google Sheets", calendar: "Google Calendar", docs: "Google Docs",
  drive: "Google Drive", airtable: "Airtable", hubspot: "HubSpot",
  typeform: "Typeform", asana: "Asana", outlook: "Outlook",
};

function makeDefaultNode(variant: NodeVariant, id: string, position: { x: number; y: number }): SchemaNode {
  if (variant.type === "trigger") {
    const labels: Record<string, string> = {
      manual: "Manual Trigger", cron: "Cron Schedule",
      webhook: "Webhook Trigger", event: "Event Trigger",
      program_output: "Program Output Trigger",
    };
    const configs: Record<string, unknown> = {
      manual:         { trigger_type: "manual" },
      cron:           { trigger_type: "cron", expression: "0 9 * * 1-5", timezone: "UTC" },
      webhook:        { trigger_type: "webhook", endpoint_id: crypto.randomUUID(), method: "POST" },
      event:          { trigger_type: "event", source: "", event: "", filter: null },
      program_output: { trigger_type: "program_output", source_program_id: "__USER_ASSIGNED__", on_status: ["success"] },
    };
    return {
      id, type: "trigger", status: "idle", connection: null,
      label: labels[variant.subtype] ?? "Trigger",
      description: "",
      position,
      config: configs[variant.subtype] as SchemaNode["config"],
    };
  }

  if (variant.type === "agent") {
    return {
      id, type: "agent", label: "AI Agent", description: "", connection: null,
      position, status: "idle",
      config: {
        model: "__USER_ASSIGNED__",
        api_key_ref: "__USER_ASSIGNED__",
        system_prompt: "",
        input_schema: null,
        output_schema: null,
        requires_approval: false,
        approval_timeout_hours: 24,
        scope_required: null,
        scope_access: "read",
        retry: { max_attempts: 3, backoff: "exponential", backoff_base_seconds: 5, fail_program_on_exhaust: false },
        tools: [],
      },
    };
  }

  if (variant.type === "step") {
    const labels: Record<string, string> = {
      transform: "Transform", filter: "Filter", branch: "Branch",
      delay: "Delay", loop: "Loop", format: "Format",
      parse: "Parse", deduplicate: "Deduplicate", sort: "Sort",
    };
    const configs: Record<string, unknown> = {
      transform:   { logic_type: "transform", transformation: "", input_schema: null, output_schema: null },
      filter:      { logic_type: "filter", condition: "", pass_schema: null },
      branch:      { logic_type: "branch", conditions: [], default_branch: "" },
      delay:       { logic_type: "delay", seconds: 5 },
      loop:        { logic_type: "loop", over: "input.items", item_var: "item" },
      format:      { logic_type: "format", template: "", output_key: "text" },
      parse:       { logic_type: "parse", input_key: "text", format: "json" },
      deduplicate: { logic_type: "deduplicate", key: "id" },
      sort:        { logic_type: "sort", key: "id", order: "asc" },
    };
    return {
      id, type: "step", status: "idle", connection: null,
      label: labels[variant.subtype] ?? "Step",
      description: "",
      position,
      config: configs[variant.subtype] as SchemaNode["config"],
    };
  }

  // connection
  if (variant.subtype === "http") {
    return {
      id, type: "connection", label: "HTTP Request", description: "", connection: null,
      position, status: "idle",
      config: {
        connector_type: "http",
        method: "GET",
        url: "",
        auth_type: "none",
        auth_value: null,
        query_params: [],
        headers: [],
        body: null,
        parse_response: true,
        timeout_seconds: null,
        retry: null,
      },
    };
  }
  // OAuth connection
  return {
    id, type: "connection",
    label: OAUTH_PROVIDER_LABELS[variant.subtype] ?? variant.subtype,
    description: "",
    connection: null, // user picks in sidebar
    position, status: "idle",
    config: {
      scope_access: "read",
      scope_required: [],
    },
  };
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface EditorShellProps {
  programId: string;
  initialSchema: ProgramSchema;
  initialValidation: ValidationResult | null;
  apiKeys: ApiKey[];
  linkedConnections: { id: string; name: string; provider: string; scopes: string[] }[];
  allConnections: { id: string; name: string; provider: string; scopes: string[] }[];
}

// ─── EditorShell ──────────────────────────────────────────────────────────────

export function EditorShell({
  programId,
  initialSchema,
  initialValidation,
  apiKeys,
  linkedConnections: initialLinkedConnections,
  allConnections,
}: EditorShellProps) {
  const router = useRouter();

  // ── Linked connections (mutable — auto-grows as user picks new ones) ───────

  const [linkedConnections, setLinkedConnections] = React.useState(initialLinkedConnections);

  // ── Reducer ───────────────────────────────────────────────────────────────

  const [state, dispatch] = useReducer(
    editorReducer,
    { ...initialEditorState(initialSchema), validationResult: initialValidation }
  );

  // ── Panel visibility ──────────────────────────────────────────────────────

  const [showHistory, setShowHistory] = React.useState(false);
  const [showPalette, setShowPalette] = React.useState(false);

  // ── Clipboard for copy/paste ──────────────────────────────────────────────

  const clipboardRef = useRef<SchemaNode | null>(null);

  // ── React Flow controlled state ───────────────────────────────────────────
  // We maintain separate RF node/edge state to pass into ReactFlow.
  // It is re-synced whenever state.schema changes.

  const [rfNodes, setRfNodes] = React.useState<ReactFlowNode[]>(() => {
    const { nodes } = toReactFlow(initialSchema, initialValidation);
    return needsLayout(nodes)
      ? applyDagreLayout(
          nodes,
          toReactFlow(initialSchema, initialValidation).edges
        )
      : nodes;
  });

  const [rfEdges, setRfEdges] = React.useState<ReactFlowEdge[]>(() => {
    return toReactFlow(initialSchema, initialValidation).edges;
  });

  // ── Sync schema → RF nodes/edges when schema changes ─────────────────────
  // We skip the sync when the change originated from RF (to avoid loops).
  const skipSyncRef = useRef(false);

  useEffect(() => {
    if (skipSyncRef.current) {
      skipSyncRef.current = false;
      return;
    }
    const { nodes, edges } = toReactFlow(state.schema, state.validationResult);
    setRfNodes(nodes);
    setRfEdges(edges);
  }, [state.schema, state.validationResult]);

  // ── Auto-save (2s debounce) ───────────────────────────────────────────────

  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const schemaRef = useRef(state.schema);
  schemaRef.current = state.schema;

  useEffect(() => {
    if (!state.isDirty) return;

    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);

    autoSaveTimerRef.current = setTimeout(async () => {
      await performSave(schemaRef.current);
    }, 2000);

    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.isDirty, state.schema]);

  // ── Save function ─────────────────────────────────────────────────────────

  const performSave = useCallback(
    async (schema: ProgramSchema) => {
      dispatch({ type: "SET_SAVING", saving: true });
      try {
        const res = await fetch(`/api/programs/${programId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ schema }),
        });
        if (res.ok) {
          dispatch({ type: "MARK_SAVED" });
        } else {
          dispatch({ type: "SET_SAVING", saving: false });
        }
      } catch {
        dispatch({ type: "SET_SAVING", saving: false });
      }
    },
    [programId]
  );

  // ── Validate ──────────────────────────────────────────────────────────────

  const handleValidate = useCallback(() => {
    const result = validatePostGenesis(state.schema, linkedConnections);
    dispatch({ type: "SET_VALIDATION", result });
  }, [state.schema, linkedConnections]);

  // Re-validate whenever linkedConnections grows (e.g. after auto-linking)
  useEffect(() => {
    const result = validatePostGenesis(state.schema, linkedConnections);
    dispatch({ type: "SET_VALIDATION", result });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkedConnections]);

  // ── Keyboard shortcuts ────────────────────────────────────────────────────

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey;

      if (meta && e.key === "s") {
        e.preventDefault();
        performSave(schemaRef.current);
        return;
      }

      if (meta && e.shiftKey && e.key === "z") {
        e.preventDefault();
        dispatch({ type: "REDO" });
        return;
      }

      if (meta && e.key === "z") {
        e.preventDefault();
        dispatch({ type: "UNDO" });
        return;
      }

      // Copy: Cmd+C
      if (meta && e.key === "c") {
        if (state.selectedNodeId) {
          const node = state.schema.nodes.find((n) => n.id === state.selectedNodeId);
          if (node) clipboardRef.current = node;
        }
        return;
      }

      // Paste: Cmd+V
      if (meta && e.key === "v") {
        if (clipboardRef.current) {
          const src = clipboardRef.current;
          const newId = crypto.randomUUID();
          const newNode: SchemaNode = {
            ...src,
            id: newId,
            label: src.label + " (copy)",
            position: { x: src.position.x + 40, y: src.position.y + 40 },
            status: "idle",
          } as SchemaNode;
          dispatch({ type: "UPDATE_NODE", nodeId: newId, patch: newNode });
          skipSyncRef.current = true;
          setRfNodes((prev) => [
            ...prev,
            {
              id: newId,
              type: newNode.type,
              position: newNode.position,
              data: {
                label: newNode.label,
                description: newNode.description,
                connection: newNode.connection,
                status: newNode.status,
                config: newNode.config,
                validationState: "valid",
                errors: [],
                warnings: [],
              },
            },
          ]);
          dispatch({ type: "SELECT_NODE", nodeId: newId });
        }
        return;
      }

      if (e.key === "Escape") {
        dispatch({ type: "SELECT_NODE", nodeId: null });
        dispatch({ type: "SELECT_EDGE", edgeId: null });
        return;
      }

      if ((e.key === "Delete" || e.key === "Backspace") && !isInputFocused()) {
        if (state.selectedNodeId) {
          dispatch({ type: "REMOVE_NODE", nodeId: state.selectedNodeId });
          skipSyncRef.current = true;
          setRfNodes((prev) => prev.filter((n) => n.id !== state.selectedNodeId));
          setRfEdges((prev) =>
            prev.filter(
              (e) => e.source !== state.selectedNodeId && e.target !== state.selectedNodeId
            )
          );
        } else if (state.selectedEdgeId) {
          dispatch({ type: "REMOVE_EDGE", edgeId: state.selectedEdgeId });
          skipSyncRef.current = true;
          setRfEdges((prev) => prev.filter((e) => e.id !== state.selectedEdgeId));
        }
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    state.selectedNodeId,
    state.selectedEdgeId,
    performSave,
  ]);

  // ── Supabase Realtime subscription for node execution status ──────────────

  useEffect(() => {
    const supabase = createBrowserClient();

    const channel = supabase
      .channel(`node_executions:${programId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "node_executions",
          filter: `program_id=eq.${programId}`,
        },
        (payload) => {
          // Update node status and execution data from realtime event
          type NodeExecPayload = {
            node_id: string;
            run_id?: string;
            status: SchemaNode["status"];
            input_payload?: unknown;
            output_payload?: unknown;
            error_message?: string | null;
            started_at?: string | null;
            completed_at?: string | null;
          };
          const row = payload.new as NodeExecPayload | null;
          if (!row?.node_id || !row?.status) return;

          // Update RF node visual status
          skipSyncRef.current = true;
          setRfNodes((prev) =>
            prev.map((n) =>
              n.id === row.node_id
                ? { ...n, data: { ...n.data, status: row.status } }
                : n
            )
          );

          // Update execution inspector data
          setNodeExecutions((prev) => ({
            ...prev,
            [row.node_id]: {
              status: row.status,
              input_payload: row.input_payload ?? null,
              output_payload: row.output_payload ?? null,
              error_message: row.error_message ?? null,
              started_at: row.started_at ?? null,
              completed_at: row.completed_at ?? null,
            },
          }));

          // Track the run ID from the first realtime event we see
          if (row.run_id) {
            setLastRunId((prev) => prev ?? row.run_id ?? null);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [programId]);

  // ── RF event handlers ─────────────────────────────────────────────────────

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      setRfNodes((nds) => applyNodeChanges(changes, nds));

      // Sync positions to schema only after drag ends.
      // React Flow emits many "position" changes while dragging (dragging=true);
      // writing schema on each tick causes full graph re-sync and UI jank.
      const finalPositionChanges = changes.filter(
        (
          c
        ): c is NodeChange & {
          type: "position";
          position: { x: number; y: number };
          dragging?: boolean;
        } => c.type === "position" && c.position != null && c.dragging !== true
      );
      if (finalPositionChanges.length > 0) {
        const latestByNodeId = new Map<string, { x: number; y: number }>();
        for (const change of finalPositionChanges) {
          latestByNodeId.set(change.id, change.position);
        }
        dispatch({
          type: "SET_POSITIONS",
          nodes: Array.from(latestByNodeId.entries()).map(([id, position]) => ({
            id,
            position,
          })),
        });
      }

      // Handle node removal initiated from RF (e.g. backspace while node selected in RF)
      const removeChanges = changes.filter((c) => c.type === "remove");
      removeChanges.forEach((c) => {
        dispatch({ type: "REMOVE_NODE", nodeId: c.id });
      });
    },
    []
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      setRfEdges((eds) => applyEdgeChanges(changes, eds));

      const removeChanges = changes.filter((c) => c.type === "remove");
      removeChanges.forEach((c) => {
        dispatch({ type: "REMOVE_EDGE", edgeId: c.id });
      });
    },
    []
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      const newEdge: ReactFlowEdge = {
        id: crypto.randomUUID(),
        source: connection.source ?? "",
        target: connection.target ?? "",
        type: "data_flow",
        markerEnd: { type: MarkerType.ArrowClosed },
        data: { condition: null, data_mapping: null, validationErrors: [] },
      };

      setRfEdges((eds) => addEdge(newEdge, eds));

      dispatch({
        type: "ADD_EDGE",
        edge: {
          id: newEdge.id,
          from: newEdge.source,
          to: newEdge.target,
          type: "data_flow",
          data_mapping: null,
          condition: null,
          label: null,
        },
      });
    },
    []
  );

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: ReactFlowNode) => {
      dispatch({ type: "SELECT_NODE", nodeId: node.id });
    },
    []
  );

  const onEdgeClick = useCallback(
    (_: React.MouseEvent, edge: ReactFlowEdge) => {
      dispatch({ type: "SELECT_EDGE", edgeId: edge.id });
    },
    []
  );

  const onPaneClick = useCallback(() => {
    dispatch({ type: "SELECT_NODE", nodeId: null });
    dispatch({ type: "SELECT_EDGE", edgeId: null });
  }, []);

  // ── Add node from palette ─────────────────────────────────────────────────

  const handleAddNode = useCallback(
    (variant: NodeVariant) => {
      const id = crypto.randomUUID();
      // Stagger new nodes slightly so rapid additions don't stack
      const offset = Math.floor(Math.random() * 60) - 30;
      const position = { x: 380 + offset, y: 200 + offset };
      const schemaNode = makeDefaultNode(variant, id, position);

      dispatch({ type: "UPDATE_NODE", nodeId: id, patch: schemaNode });

      skipSyncRef.current = true;
      const rfNode: ReactFlowNode = {
        id,
        type,
        position,
        data: {
          label: schemaNode.label,
          description: schemaNode.description,
          connection: schemaNode.connection,
          status: schemaNode.status,
          config: schemaNode.config,
          validationState: "valid",
          errors: [],
          warnings: [],
        },
      };
      setRfNodes((prev) => [...prev, rfNode]);
    },
    []
  );

  // ── Sidebar config update ─────────────────────────────────────────────────

  const handleSidebarUpdate = useCallback(
    (nodeId: string, config: Record<string, unknown>) => {
      // Separate top-level node fields from config fields
      const { label, description, connection, ...configPatch } = config;

      if (label !== undefined || description !== undefined || connection !== undefined) {
        dispatch({
          type: "UPDATE_NODE",
          nodeId,
          patch: {
            ...(label !== undefined ? { label: label as string } : {}),
            ...(description !== undefined ? { description: description as string } : {}),
            ...(connection !== undefined ? { connection: connection as string | null } : {}),
          },
        });

        // Auto-link a newly selected connection to this program
        if (connection && typeof connection === "string") {
          const alreadyLinked = linkedConnections.some((c) => c.name === connection);
          if (!alreadyLinked) {
            const picked = allConnections.find((c) => c.name === connection);
            if (picked) {
              // Optimistic update
              setLinkedConnections((prev) => [...prev, picked]);
              // Persist to DB
              fetch(`/api/programs/${programId}/connections`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ connection_id: picked.id }),
              }).catch(() => {
                // Revert on failure
                setLinkedConnections((prev) => prev.filter((c) => c.id !== picked.id));
              });
            }
          }
        }
      }

      if (Object.keys(configPatch).length > 0) {
        dispatch({ type: "UPDATE_NODE_CONFIG", nodeId, config: configPatch });
      }
    },
    [programId, linkedConnections, allConnections]
  );

  // ── Node execution inspector state ───────────────────────────────────────

  const [nodeExecutions, setNodeExecutions] = React.useState<Record<string, NodeExecutionData>>({});
  const [lastRunId, setLastRunId] = React.useState<string | null>(null);

  // On mount: fetch most recent run and populate nodeExecutions
  useEffect(() => {
    async function fetchLatestRun() {
      try {
        const listRes = await fetch(`/api/runs?program_id=${programId}`);
        if (!listRes.ok) return;
        const runs = await listRes.json() as Array<{ id: string }>;
        if (!runs || runs.length === 0) return;
        const runId = runs[0].id;
        setLastRunId(runId);

        const runRes = await fetch(`/api/runs/${runId}`);
        if (!runRes.ok) return;
        const run = await runRes.json() as { node_executions?: Array<{
          node_id: string;
          status: SchemaNode["status"];
          input_payload: unknown;
          output_payload: unknown;
          error_message: string | null;
          started_at: string | null;
          completed_at: string | null;
        }> };
        if (!run.node_executions) return;

        const byNodeId: Record<string, NodeExecutionData> = {};
        for (const ne of run.node_executions) {
          byNodeId[ne.node_id] = {
            status: ne.status,
            input_payload: ne.input_payload,
            output_payload: ne.output_payload,
            error_message: ne.error_message,
            started_at: ne.started_at,
            completed_at: ne.completed_at,
          };
        }
        setNodeExecutions(byNodeId);
      } catch {
        // Non-critical — silently ignore
      }
    }
    fetchLatestRun();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [programId]);

  // ── Webhook test state ────────────────────────────────────────────────────

  const hasWebhookTrigger = React.useMemo(
    () =>
      state.schema.nodes.some(
        (n) =>
          n.type === "trigger" &&
          (n.config as Record<string, unknown>).trigger_type === "webhook"
      ),
    [state.schema.nodes]
  );

  const [showWebhookTest, setShowWebhookTest] = React.useState(false);
  const [webhookPayload, setWebhookPayload] = React.useState('{\n  \n}');
  const [webhookPayloadValid, setWebhookPayloadValid] = React.useState(false);

  // Validate JSON on every keystroke
  const handleWebhookPayloadChange = React.useCallback((value: string) => {
    setWebhookPayload(value);
    try {
      JSON.parse(value);
      setWebhookPayloadValid(true);
    } catch {
      setWebhookPayloadValid(false);
    }
  }, []);

  // ── Run ───────────────────────────────────────────────────────────────────

  const [isRunning, setIsRunning] = React.useState(false);
  const [preFlightChecks, setPreFlightChecks] = React.useState<PreFlightCheck[] | null>(null);

  const handleRun = useCallback(async () => {
    if (state.validationResult && !state.validationResult.valid) return;
    setIsRunning(true);
    try {
      const res = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ program_id: programId }),
      });
      if (res.ok) {
        const { run_id } = await res.json();
        router.push(`/programs/${programId}/runs/${run_id}`);
      } else {
        const body = await res.json().catch(() => null);
        if (body?.checks) {
          setPreFlightChecks(body.checks as PreFlightCheck[]);
        } else {
          setPreFlightChecks([{
            code: "PRE_001",
            label: "Error",
            status: "fail",
            failures: [{ node_id: null, message: body?.error ?? "Failed to start run", fix_suggestion: "" }],
          }]);
        }
      }
    } catch {
      setPreFlightChecks([{
        code: "PRE_001",
        label: "Connection error",
        status: "fail",
        failures: [{ node_id: null, message: "Could not reach the server.", fix_suggestion: "Make sure the runtime service is running." }],
      }]);
    } finally {
      setIsRunning(false);
    }
  }, [state.validationResult, programId, router]);

  // ── Test webhook ──────────────────────────────────────────────────────────

  const handleTestWebhook = useCallback(async () => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(webhookPayload);
    } catch {
      // Shouldn't reach here — button is disabled when invalid — but guard anyway
      return;
    }

    setIsRunning(true);
    try {
      const res = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ program_id: programId, trigger_payload: parsed }),
      });
      if (res.ok) {
        const { run_id } = await res.json() as { run_id: string };
        setShowWebhookTest(false);
        router.push(`/programs/${programId}/runs/${run_id}`);
      } else {
        const body = await res.json().catch(() => null) as { checks?: PreFlightCheck[]; error?: string } | null;
        setShowWebhookTest(false);
        if (body?.checks) {
          setPreFlightChecks(body.checks);
        } else {
          setPreFlightChecks([{
            code: "PRE_001",
            label: "Error",
            status: "fail",
            failures: [{ node_id: null, message: body?.error ?? "Failed to start test run", fix_suggestion: "" }],
          }]);
        }
      }
    } catch {
      setShowWebhookTest(false);
      setPreFlightChecks([{
        code: "PRE_001",
        label: "Connection error",
        status: "fail",
        failures: [{ node_id: null, message: "Could not reach the server.", fix_suggestion: "Make sure the runtime service is running." }],
      }]);
    } finally {
      setIsRunning(false);
    }
  }, [webhookPayload, programId, router]);

  // ── Back navigation ───────────────────────────────────────────────────────

  const handleBack = useCallback(() => {
    router.push(`/programs/${programId}`);
  }, [router, programId]);

  // ── Viewport width detection for mobile read-only ─────────────────────────

  const [isMobile, setIsMobile] = React.useState(false);
  useEffect(() => {
    function check() {
      setIsMobile(window.innerWidth < 768);
    }
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // ── canUndo / canRedo ─────────────────────────────────────────────────────

  const canUndo = state.past.length > 0;
  const canRedo = state.future.length > 0;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden">
      {/* Toolbar — fixed at top */}
      <EditorToolbar
        programId={programId}
        programName={state.schema.program_name}
        isDirty={state.isDirty}
        isSaving={state.isSaving}
        canUndo={canUndo}
        canRedo={canRedo}
        validationResult={state.validationResult}
        onUndo={() => dispatch({ type: "UNDO" })}
        onRedo={() => dispatch({ type: "REDO" })}
        isRunning={isRunning}
        onSave={() => performSave(state.schema)}
        onValidate={handleValidate}
        onRun={handleRun}
        onBack={handleBack}
        showPalette={showPalette}
        onTogglePalette={() => {
          setShowPalette((v) => !v);
          if (showHistory) setShowHistory(false);
        }}
        onHistory={() => {
          setShowHistory((prev) => !prev);
          if (!showHistory) {
            dispatch({ type: "SELECT_NODE", nodeId: null });
            setShowPalette(false);
          }
        }}
        onTestWebhook={hasWebhookTrigger ? () => setShowWebhookTest(true) : undefined}
      />

      {/* Node palette panel — slides in from left */}
      {showPalette && !isMobile && (
        <NodePalettePanel
          onAdd={handleAddNode}
          onClose={() => setShowPalette(false)}
        />
      )}

      {/* Canvas area — below toolbar, offset left when palette is open */}
      <div
        className="relative h-[calc(100vh-56px)] mt-14 transition-[padding-left] duration-200"
        style={{ paddingLeft: showPalette && !isMobile ? 240 : 0 }}
      >
        {/* Mobile banner */}
        {isMobile && (
          <div className="absolute inset-x-0 top-0 z-20 bg-amber-50 dark:bg-amber-950/50 border-b border-amber-200 dark:border-amber-800 px-4 py-2 text-xs text-amber-800 dark:text-amber-300 text-center">
            The visual editor is read-only on mobile. Open on desktop to edit.
          </div>
        )}

        <ReactFlow
          nodes={rfNodes}
          edges={rfEdges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={isMobile ? undefined : onNodesChange}
          onEdgesChange={isMobile ? undefined : onEdgesChange}
          onConnect={isMobile ? undefined : onConnect}
          onNodeClick={isMobile ? undefined : onNodeClick}
          onEdgeClick={isMobile ? undefined : onEdgeClick}
          onPaneClick={onPaneClick}
          nodesDraggable={!isMobile}
          nodesConnectable={!isMobile}
          elementsSelectable={!isMobile}
          fitView
          fitViewOptions={{ padding: 0.15 }}
          defaultEdgeOptions={{
            type: "data_flow",
            markerEnd: { type: MarkerType.ArrowClosed },
          }}
          className="bg-background"
        >
          <Background color="hsl(var(--border))" gap={20} size={1} />
          <Controls className="!border-border !bg-background !shadow-sm" />
          <MiniMap
            className="!border-border !bg-background !shadow-sm"
            nodeColor={(node) => {
              const typeColors: Record<string, string> = {
                trigger: "#22c55e",
                agent: "#a855f7",
                step: "#3b82f6",
                connection: "#94a3b8",
              };
              return typeColors[node.type ?? ""] ?? "#94a3b8";
            }}
          />
        </ReactFlow>

        {/* Node sidebar — slides in from right (hidden when history panel is open) */}
        {state.selectedNodeId && !isMobile && !showHistory && (
          <NodeSidebar
            nodeId={state.selectedNodeId}
            schema={state.schema}
            programId={programId}
            apiKeys={apiKeys}
            connections={allConnections}
            validationResult={state.validationResult}
            nodeExecutions={nodeExecutions}
            lastRunId={lastRunId}
            onUpdate={handleSidebarUpdate}
            onClose={() => dispatch({ type: "SELECT_NODE", nodeId: null })}
            onDelete={(nodeId) => {
              dispatch({ type: "REMOVE_NODE", nodeId });
              dispatch({ type: "SELECT_NODE", nodeId: null });
            }}
          />
        )}

        {/* Version history panel — slides in from right */}
        {showHistory && (
          <VersionHistoryPanel
            programId={programId}
            currentVersion={state.schema.version_history.length > 0
              ? Math.max(...state.schema.version_history.map((v) => v.version_number))
              : 0}
            onRollback={(schema) => {
              dispatch({ type: "RESTORE_VERSION", schema });
              setShowHistory(false);
            }}
            onClose={() => setShowHistory(false)}
          />
        )}
      </div>

      {/* Webhook test dialog */}
      <Dialog open={showWebhookTest} onOpenChange={(open) => { if (!open) setShowWebhookTest(false); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Test webhook trigger</DialogTitle>
            <DialogDescription>
              Paste a sample payload to test this webhook program. The run will start immediately.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Textarea
              rows={8}
              className="font-mono text-xs resize-none"
              value={webhookPayload}
              onChange={(e) => handleWebhookPayloadChange(e.target.value)}
              placeholder={'{\n  "key": "value"\n}'}
              spellCheck={false}
            />
            <p className={cn(
              "text-[11px] font-medium",
              webhookPayloadValid ? "text-green-600 dark:text-green-400" : "text-destructive"
            )}>
              {webhookPayloadValid ? "JSON valid" : "Invalid JSON"}
            </p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowWebhookTest(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleTestWebhook}
              disabled={!webhookPayloadValid || isRunning}
            >
              {isRunning ? "Starting…" : "Send test"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Pre-flight failure dialog */}
      <Dialog open={!!preFlightChecks} onOpenChange={(open) => { if (!open) setPreFlightChecks(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <span>⚠</span> Pre-flight check failed
            </DialogTitle>
            <p className="text-sm text-muted-foreground">Fix the following issues before running this program.</p>
          </DialogHeader>

          <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
            {(preFlightChecks ?? [])
              .filter((c) => c.status === "fail")
              .map((check) => (
                <div key={check.code} className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {check.label}
                  </p>
                  {check.failures.map((f, i) => {
                    const fixLink = preFlightFixLink(check.code, f.fix_suggestion);
                    return (
                      <div key={i} className="rounded-md border border-destructive/40 bg-destructive/5 p-3 space-y-2">
                        <p className="text-sm font-medium text-foreground">{f.message}</p>
                        {f.fix_suggestion && (
                          <div className="flex items-start justify-between gap-3">
                            <p className="text-xs text-muted-foreground">
                              <span className="font-medium text-primary">How to fix: </span>
                              {f.fix_suggestion}
                            </p>
                            {fixLink && (
                              <a
                                href={fixLink.href}
                                className="shrink-0 text-xs font-medium text-primary underline underline-offset-2 hover:opacity-80 whitespace-nowrap"
                                onClick={() => setPreFlightChecks(null)}
                              >
                                {fixLink.label} →
                              </a>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setPreFlightChecks(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Utility: map a pre-flight check code to an actionable link ──────────────

function preFlightFixLink(
  code: string,
  fixSuggestion: string
): { href: string; label: string } | null {
  if (code === "PRE_001" || code === "PRE_003" || fixSuggestion.toLowerCase().includes("connection")) {
    return { href: "/connections", label: "Go to Connections" };
  }
  if (code === "PRE_002" || fixSuggestion.toLowerCase().includes("api key")) {
    return { href: "/api-keys", label: "Go to API Keys" };
  }
  return null;
}

// ─── Utility: detect if a form input is currently focused ────────────────────

function isInputFocused(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName.toLowerCase();
  return (
    tag === "input" ||
    tag === "textarea" ||
    tag === "select" ||
    (el as HTMLElement).isContentEditable
  );
}
