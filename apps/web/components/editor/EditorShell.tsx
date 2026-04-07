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

import type { ProgramSchema, Node as SchemaNode } from "@flowos/schema";
import type { ValidationResult } from "@/lib/validation";
import { createBrowserClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

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

function makeDefaultNode(
  type: "trigger" | "agent" | "step",
  id: string,
  position: { x: number; y: number }
): SchemaNode {
  if (type === "trigger") {
    return {
      id,
      type: "trigger",
      label: "New Trigger",
      description: "",
      connection: null,
      config: { trigger_type: "manual" },
      position,
      status: "idle",
    };
  }
  if (type === "agent") {
    return {
      id,
      type: "agent",
      label: "New Agent",
      description: "",
      connection: null,
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
        retry: {
          max_attempts: 3,
          backoff: "exponential",
          backoff_base_seconds: 5,
          fail_program_on_exhaust: false,
        },
        tools: [],
      },
      position,
      status: "idle",
    };
  }
  // step
  return {
    id,
    type: "step",
    label: "New Step",
    description: "",
    connection: null,
    config: {
      logic_type: "transform",
      transformation: "",
      input_schema: null,
      output_schema: null,
    },
    position,
    status: "idle",
  };
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface EditorShellProps {
  programId: string;
  initialSchema: ProgramSchema;
  initialValidation: ValidationResult | null;
  apiKeys: ApiKey[];
}

// ─── EditorShell ──────────────────────────────────────────────────────────────

export function EditorShell({
  programId,
  initialSchema,
  initialValidation,
  apiKeys,
}: EditorShellProps) {
  const router = useRouter();

  // ── Reducer ───────────────────────────────────────────────────────────────

  const [state, dispatch] = useReducer(
    editorReducer,
    { ...initialEditorState(initialSchema), validationResult: initialValidation }
  );

  // ── Version history panel visibility ─────────────────────────────────────

  const [showHistory, setShowHistory] = React.useState(false);

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
    // Run post-genesis validation with empty connections (live connections
    // checked client-side via pre-flight; connections fetched separately)
    const result = validatePostGenesis(state.schema, []);
    dispatch({ type: "SET_VALIDATION", result });
  }, [state.schema]);

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
          // Update node status from realtime event
          type NodeExecPayload = {
            node_id: string;
            status: SchemaNode["status"];
          };
          const row = payload.new as NodeExecPayload | null;
          if (!row?.node_id || !row?.status) return;

          skipSyncRef.current = true;
          setRfNodes((prev) =>
            prev.map((n) =>
              n.id === row.node_id
                ? { ...n, data: { ...n.data, status: row.status } }
                : n
            )
          );
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

      // Capture position changes and sync to reducer (debounced)
      const posChanges = changes.filter(
        (c): c is NodeChange & { type: "position"; position: { x: number; y: number } } =>
          c.type === "position" && c.position != null
      );
      if (posChanges.length > 0) {
        dispatch({
          type: "SET_POSITIONS",
          nodes: posChanges.map((c) => ({
            id: c.id,
            position: (c as { id: string; position: { x: number; y: number } }).position,
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

  // ── Add node from toolbar ─────────────────────────────────────────────────

  const handleAddNode = useCallback(
    (type: "trigger" | "agent" | "step") => {
      const id = crypto.randomUUID();
      const position = { x: 400, y: 200 };
      const schemaNode = makeDefaultNode(type, id, position);

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
      // Separate label/description from config fields
      const { label, description, ...configPatch } = config;

      if (label !== undefined || description !== undefined) {
        dispatch({
          type: "UPDATE_NODE",
          nodeId,
          patch: {
            ...(label !== undefined ? { label: label as string } : {}),
            ...(description !== undefined ? { description: description as string } : {}),
          },
        });
      }

      if (Object.keys(configPatch).length > 0) {
        dispatch({ type: "UPDATE_NODE_CONFIG", nodeId, config: configPatch });
      }
    },
    []
  );

  // ── Run ───────────────────────────────────────────────────────────────────

  const handleRun = useCallback(async () => {
    if (state.validationResult && !state.validationResult.valid) return;
    // TODO(Phase 3): POST to runtime
    alert("Run functionality will be available in Phase 3.");
  }, [state.validationResult]);

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
        onSave={() => performSave(state.schema)}
        onValidate={handleValidate}
        onRun={handleRun}
        onBack={handleBack}
        onAddNode={handleAddNode}
        onHistory={() => {
          setShowHistory((prev) => !prev);
          // Close node sidebar when opening history panel
          if (!showHistory) dispatch({ type: "SELECT_NODE", nodeId: null });
        }}
      />

      {/* Canvas area — below toolbar */}
      <div className="relative h-[calc(100vh-56px)] mt-14">
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
            apiKeys={apiKeys}
            onUpdate={handleSidebarUpdate}
            onClose={() => dispatch({ type: "SELECT_NODE", nodeId: null })}
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
    </div>
  );
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
