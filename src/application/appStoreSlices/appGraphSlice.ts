import type { StateCreator } from "zustand";
import type { FlowEdge, FlowNode } from "../../domain/index.ts";
import type { ParseDiagnosticPayload } from "../../infrastructure/index.ts";
import type { AppStore } from "../appStore.ts";

export interface AppGraphState {
  flowNodes: FlowNode[];
  flowEdges: FlowEdge[];
  parseDiagnostics: ParseDiagnosticPayload[];
  importRevision: number;
}

export interface AppGraphActions {
  partialParseSuccess: (
    nodes: FlowNode[],
    edges: FlowEdge[],
    diagnostics?: ParseDiagnosticPayload[],
  ) => void;
  parseSuccess: (
    nodes: FlowNode[],
    edges: FlowEdge[],
    diagnostics?: ParseDiagnosticPayload[],
  ) => void;
}

export type AppGraphSlice = AppGraphState & AppGraphActions;

export const defaultAppGraphState: AppGraphState = {
  flowNodes: [],
  flowEdges: [],
  parseDiagnostics: [],
  importRevision: 0,
};

export const createAppGraphSlice: StateCreator<
  AppStore,
  [["zustand/immer", never]],
  [],
  AppGraphSlice
> = (set) => ({
  ...defaultAppGraphState,

  partialParseSuccess: (nodes, edges, diagnostics) =>
    set((draft) => {
      draft.phase = "parsing";
      draft.flowNodes = nodes;
      draft.flowEdges = edges;
      if (diagnostics !== undefined) {
        draft.parseDiagnostics = diagnostics;
      }
    }),

  parseSuccess: (nodes, edges, diagnostics) =>
    set((draft) => {
      draft.phase = "done";
      draft.flowNodes = nodes;
      draft.flowEdges = edges;
      draft.parseDiagnostics = diagnostics ?? [];
      draft.parseProgress = null;
      draft.importRevision += 1;
    }),
});
