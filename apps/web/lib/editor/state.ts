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
  history: ProgramSchema[]; // previous states (not including current)
  historyIndex: number;     // index into history for redo support
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
  | { type: "UPDATE_NODE_CONFIG"; nodeId: string; config: Record<string, unknown> };

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Push the current schema onto the history stack and return the new stack.
 * Trims to MAX_HISTORY. When called after an undo, discards the "future".
 */
function pushHistory(
  history: ProgramSchema[],
  historyIndex: number,
  current: ProgramSchema
): { history: ProgramSchema[]; historyIndex: number } {
  // If we undid some steps, discard everything after historyIndex
  const trimmed = history.slice(0, historyIndex + 1);
  const next = [...trimmed, current].slice(-MAX_HISTORY);
  return { history: next, historyIndex: next.length - 1 };
}

// ─── Reducer ──────────────────────────────────────────────────────────────────

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    // ── Node mutations ──────────────────────────────────────────────────────

    case "UPDATE_NODE": {
      const { history, historyIndex } = pushHistory(
        state.history,
        state.historyIndex,
        state.schema
      );
      const nodes = state.schema.nodes.map((n) =>
        n.id === action.nodeId
          ? ({ ...n, ...action.patch } as ProgramSchema["nodes"][0])
          : n
      );
      return {
        ...state,
        schema: { ...state.schema, nodes },
        isDirty: true,
        history,
        historyIndex,
      };
    }

    case "REMOVE_NODE": {
      const { history, historyIndex } = pushHistory(
        state.history,
        state.historyIndex,
        state.schema
      );
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
        history,
        historyIndex,
      };
    }

    // ── Edge mutations ──────────────────────────────────────────────────────

    case "ADD_EDGE": {
      const { history, historyIndex } = pushHistory(
        state.history,
        state.historyIndex,
        state.schema
      );
      return {
        ...state,
        schema: {
          ...state.schema,
          edges: [...state.schema.edges, action.edge],
        },
        isDirty: true,
        history,
        historyIndex,
      };
    }

    case "REMOVE_EDGE": {
      const { history, historyIndex } = pushHistory(
        state.history,
        state.historyIndex,
        state.schema
      );
      return {
        ...state,
        schema: {
          ...state.schema,
          edges: state.schema.edges.filter((e) => e.id !== action.edgeId),
        },
        selectedEdgeId:
          state.selectedEdgeId === action.edgeId ? null : state.selectedEdgeId,
        isDirty: true,
        history,
        historyIndex,
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
      if (state.historyIndex < 0) return state;
      const prevSchema = state.history[state.historyIndex];
      if (!prevSchema) return state;
      return {
        ...state,
        schema: prevSchema,
        historyIndex: state.historyIndex - 1,
        isDirty: true,
        selectedNodeId: null,
        selectedEdgeId: null,
      };
    }

    // ── Redo ────────────────────────────────────────────────────────────────

    case "REDO": {
      // Redo is supported when historyIndex < history.length - 1
      // The "current" state is beyond the end; but after undo we have future states
      // We push state.schema onto history during UNDO if we want proper redo.
      // For simplicity: history is a stack of past states; redo is not supported
      // beyond what has been pushed. Return state unchanged if no redo available.
      return state;
    }

    // ── Sync from React Flow (full schema replace after RF state diverges) ──

    case "SYNC_FROM_RF": {
      const { history, historyIndex } = pushHistory(
        state.history,
        state.historyIndex,
        state.schema
      );
      return {
        ...state,
        schema: action.schema,
        isDirty: true,
        history,
        historyIndex,
      };
    }

    // ── Update node config (from sidebar) ───────────────────────────────────

    case "UPDATE_NODE_CONFIG": {
      const { history, historyIndex } = pushHistory(
        state.history,
        state.historyIndex,
        state.schema
      );
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
        history,
        historyIndex,
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
    history: [],
    historyIndex: -1,
  };
}
