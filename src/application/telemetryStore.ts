import { create } from 'zustand';

export interface TelemetryMetrics {
  readMs: number | null;
  parseMs: number | null;
  layoutMs: number | null;
  renderMs: number | null;
  nodesCount: number;
  edgesCount: number;
  fileCount: number;
}

export interface TelemetryActions {
  recordRead: (ms: number) => void;
  recordParse: (ms: number, detail?: { files?: number; nodes?: number; edges?: number }) => void;
  recordLayout: (ms: number) => void;
  recordRender: (ms: number) => void;
  setGraphMetrics: (nodes: number, edges: number) => void;
  setFileCount: (count: number) => void;
  reset: () => void;
}

export type TelemetryStore = TelemetryMetrics & TelemetryActions;

const initialMetrics: TelemetryMetrics = {
  readMs: null,
  parseMs: null,
  layoutMs: null,
  renderMs: null,
  nodesCount: 0,
  edgesCount: 0,
  fileCount: 0,
};

export const useTelemetryStore = create<TelemetryStore>((set) => ({
  ...initialMetrics,

  recordRead: (ms) => set({ readMs: ms }),

  recordParse: (ms, detail) =>
    set((state) => ({
      parseMs: ms,
      ...(detail?.files != null ? { fileCount: detail.files } : {}),
      ...(detail?.nodes != null ? { nodesCount: detail.nodes } : {}),
      ...(detail?.edges != null ? { edgesCount: detail.edges } : {}),
      // preserve existing values for fields not in detail
      ...(detail?.files == null ? { fileCount: state.fileCount } : {}),
    })),

  recordLayout: (ms) => set({ layoutMs: ms }),

  recordRender: (ms) => set({ renderMs: ms }),

  setGraphMetrics: (nodes, edges) => set({ nodesCount: nodes, edgesCount: edges }),

  setFileCount: (count) => set({ fileCount: count }),

  reset: () => set(initialMetrics),
}));
