import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { FlowEdge, FlowNode } from '../domain';
import type { AppPhase } from './appTypes';
import type { ParseWarningPayload } from '../infrastructure';

export type ParseProgress = {
  doneFiles: number;
  totalFiles: number;
  currentFile: string;
};

export type DialogueSearchMode = 'auto' | 'full' | 'countOnly';

export interface AppState {
  phase: AppPhase;
  flowNodes: FlowNode[];
  flowEdges: FlowEdge[];
  parseWarnings: ParseWarningPayload[];
  errorMsg: string;
  fileCount: number;
  parseProgress: ParseProgress | null;
  importRevision: number;
  dialogueSearchMode: DialogueSearchMode;
}

export interface AppActions {
  reset: () => void;
  startReading: (fileCount: number) => void;
  startParsing: () => void;
  setProgress: (progress: ParseProgress) => void;
  partialParseSuccess: (nodes: FlowNode[], edges: FlowEdge[], warnings?: ParseWarningPayload[]) => void;
  parseSuccess: (nodes: FlowNode[], edges: FlowEdge[], warnings?: ParseWarningPayload[]) => void;
  setDialogueSearchMode: (mode: DialogueSearchMode) => void;
  fail: (message: string) => void;
}

export type AppStore = AppState & AppActions;

const initialState: AppState = {
  phase: 'idle',
  flowNodes: [],
  flowEdges: [],
  parseWarnings: [],
  errorMsg: '',
  fileCount: 0,
  parseProgress: null,
  importRevision: 0,
  dialogueSearchMode: 'auto',
};

export const useAppStore = create<AppStore>()(
  immer((set) => ({
    ...initialState,

    reset: () => set(() => ({ ...initialState })),

    startReading: (fileCount) =>
      set((draft) => {
        draft.phase = 'reading';
        draft.fileCount = fileCount;
        draft.errorMsg = '';
        draft.parseProgress = { doneFiles: 0, totalFiles: fileCount, currentFile: '' };
      }),

    startParsing: () =>
      set((draft) => {
        draft.phase = 'parsing';
      }),

    setProgress: (progress) =>
      set((draft) => {
        draft.parseProgress = progress;
      }),

    partialParseSuccess: (nodes, edges, warnings) =>
      set((draft) => {
        draft.phase = 'parsing';
        draft.flowNodes = nodes;
        draft.flowEdges = edges;
        if (warnings !== undefined) {
          draft.parseWarnings = warnings;
        }
      }),

    parseSuccess: (nodes, edges, warnings) =>
      set((draft) => {
        draft.phase = 'done';
        draft.flowNodes = nodes;
        draft.flowEdges = edges;
        draft.parseWarnings = warnings ?? [];
        draft.parseProgress = null;
        draft.importRevision += 1;
      }),

    setDialogueSearchMode: (mode) =>
      set((draft) => {
        draft.dialogueSearchMode = mode;
      }),

    fail: (message) =>
      set((draft) => {
        draft.phase = 'error';
        draft.errorMsg = message;
        draft.parseProgress = null;
      }),
  })),
);
