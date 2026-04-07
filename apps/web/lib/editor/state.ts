import type { ProgramSchema } from "@flowos/schema";
import type { ValidationResult } from "@/lib/validation";

const MAX_HISTORY = 20;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EditorState {
  schema: ProgramSchema;
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
  validationResult: ValidationResult | null;
  isDirty: boolean;
  isSaving: boolean;
  /** States before current — pop to undo. */
  past: ProgramSchema[];
  /** States after current — pop to redo. Cleared on any new mutation. */
  future: ProgramSchema[];
}

export type EditorAction =
  | { type: "UPDATE_NODE"; nodeId: string; patch: Partial<ProgramSchema["nodes"][0]> }
  | { type: "REMOVE_NODE"; nodeId: string }
  | { type: "ADD_EDGE"; edge: ProgramSchema["edges"][0] }
  | { type: "REMOVE_EDGE"; edgeId: string }
  | {
      type: "SET_POSITIONS";
      nodes: Array<{ id: string; position: { x: number; y: number } }>;
    }
  | { type: "SELECT_NODE"; nodeId: string | null }
  | { type: "SELECT_EDGE"; edgeId: string | null }
  | { type: "SET_VALIDATION"; result: ValidationResult }
  | { type: "SET_SAVING"; saving: boolean }
  | { type: "MARK_SAVED" }
  | { type: "UNDO" }
  | { type: "REDO" }
  | { type: "SYNC_FROM_RF"; schema: ProgramSchema }
  | { type: "UPDATE_NODE_CONFIG"; nodeId: string; config: Record<string, unknown> }
  | { type: "RESTORE_VERSION"; schema: ProgramSchema };

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Push the current schema onto the past stack and clear the future stack.
 * Any new mutation "forks" the timeline — future states are discarded.
 * Trims past to MAX_HISTORY entries.
 */
function pushPast(
  past: ProgramSchema[],
  current: ProgramSchema
): { past: ProgramSchema[]; future: ProgramSchema[] } {
  const next = [...past, current].slice(-MAX_HISTORY);
  return { past: next, future: [] };
}

// ─── Reducer ──────────────────────────────────────────────────────────────────

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    // ── Node mutations ──────────────────────────────────────────────────────

    case "UPDATE_NODE": {
      const { past, future } = pushPast(state.past, state.schema);
      const nodes = state.schema.nodes.map((n) =>
        n.id === action.nodeId
          ? ({ ...n, ...action.patch } as ProgramSchema["nodes"][0])
          : n
      );
      // If the node doesn't exist yet (paste / add case), append it
      const exists = state.schema.nodes.some((n) => n.id === action.nodeId);
      const finalNodes = exists
        ? nodes
        : [...state.schema.nodes, action.patch as ProgramSchema["nodes"][0]];
      return {
        ...state,
        schema: { ...state.schema, nodes: finalNodes },
        isDirty: true,
        past,
        future,
      };
    }

    case "REMOVE_NODE": {
      const { past, future } = pushPast(state.past, state.schema);
      const nodes = state.schema.nodes.filter((n) => n.id !== action.nodeId);
      // Also remove any edges connected to the removed node
      const edges = state.schema.edges.filter(
        (e) => e.from !== action.nodeId && e.to !== action.nodeId
      );
      return {
        ...state,
        schema: { ...state.schema, nodes, edges },
        selectedNodeId:
          state.selectedNodeId === action.nodeId ? null : state.selectedNodeId,
        isDirty: true,
        past,
        future,
      };
    }

    // ── Edge mutations ──────────────────────────────────────────────────────

    case "ADD_EDGE": {
      const { past, future } = pushPast(state.past, state.schema);
      return {
        ...state,
        schema: {
          ...state.schema,
          edges: [...state.schema.edges, action.edge],
        },
        isDirty: true,
        past,
        future,
      };
    }

    case "REMOVE_EDGE": {
      const { past, future } = pushPast(state.past, state.schema);
      return {
        ...state,
        schema: {
          ...state.schema,
          edges: state.schema.edges.filter((e) => e.id !== action.edgeId),
        },
        selectedEdgeId:
          state.selectedEdgeId === action.edgeId ? null : state.selectedEdgeId,
        isDirty: true,
        past,
        future,
      };
    }

    // ── Position-only update (no history push — too noisy during drag) ──────

    case "SET_POSITIONS": {
      const posMap = new Map(action.nodes.map((n) => [n.id, n.position]));
      const nodes = state.schema.nodes.map((n) => {
        const pos = posMap.get(n.id);
        return pos ? { ...n, position: pos } : n;
      });
      return {
        ...state,
        schema: { ...state.schema, nodes },
        isDirty: true,
      };
    }

    // ── Selection ───────────────────────────────────────────────────────────

    case "SELECT_NODE":
      return {
        ...state,
        selectedNodeId: action.nodeId,
        selectedEdgeId: action.nodeId ? null : state.selectedEdgeId,
      };

    case "SELECT_EDGE":
      return {
        ...state,
        selectedEdgeId: action.edgeId,
        selectedNodeId: action.edgeId ? null : state.selectedNodeId,
      };

    // ── Validation ──────────────────────────────────────────────────────────

    case "SET_VALIDATION":
      return { ...state, validationResult: action.result };

    // ── Save state ──────────────────────────────────────────────────────────

    case "SET_SAVING":
      return { ...state, isSaving: action.saving };

    case "MARK_SAVED":
      return { ...state, isDirty: false, isSaving: false };

    // ── Undo ────────────────────────────────────────────────────────────────

    case "UNDO": {
      if (state.past.length === 0) return state;
      const past = [...state.past];
      const prevSchema = past.pop()!;
      return {
        ...state,
        schema: prevSchema,
        past,
        future: [state.schema, ...state.future],
        isDirty: true,
        selectedNodeId: null,
        selectedEdgeId: null,
      };
    }

    // ── Redo ────────────────────────────────────────────────────────────────

    case "REDO": {
      if (state.future.length === 0) return state;
      const future = [...state.future];
      const nextSchema = future.shift()!;
      return {
        ...state,
        schema: nextSchema,
        past: [...state.past, state.schema].slice(-MAX_HISTORY),
        future,
        isDirty: true,
        selectedNodeId: null,
        selectedEdgeId: null,
      };
    }

    // ── Sync from React Flow (full schema replace after RF state diverges) ──

    case "SYNC_FROM_RF": {
      const { past, future } = pushPast(state.past, state.schema);
      return {
        ...state,
        schema: action.schema,
        isDirty: true,
        past,
        future,
      };
    }

    // ── Update node config (from sidebar) ───────────────────────────────────

    case "UPDATE_NODE_CONFIG": {
      const { past, future } = pushPast(state.past, state.schema);
      const nodes = state.schema.nodes.map((n) => {
        if (n.id !== action.nodeId) return n;
        return {
          ...n,
          config: { ...n.config, ...action.config },
        } as ProgramSchema["nodes"][0];
      });
      return {
        ...state,
        schema: { ...state.schema, nodes },
        isDirty: true,
        past,
        future,
      };
    }

    // ── Restore version (from version history panel) ─────────────────────────

    case "RESTORE_VERSION": {
      const { past, future } = pushPast(state.past, state.schema);
      return {
        ...state,
        schema: action.schema,
        isDirty: true,
        past,
        future,
        selectedNodeId: null,
        selectedEdgeId: null,
      };
    }

    default:
      return state;
  }
}

// ─── initialEditorState ───────────────────────────────────────────────────────

export function initialEditorState(schema: ProgramSchema): EditorState {
  return {
    schema,
    selectedNodeId: null,
    selectedEdgeId: null,
    validationResult: null,
    isDirty: false,
    isSaving: false,
    past: [],
    future: [],
  };
}
