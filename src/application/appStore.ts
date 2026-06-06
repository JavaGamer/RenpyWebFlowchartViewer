/**
 * src/application/appStore.ts
 *
 * Zustand store for global import/parse lifecycle state.
 * Tracks the current processing phase, accumulated parse results, and
 * any diagnostics or error messages produced during parsing.
 *
 * This store is intentionally narrow in scope; UI-specific viewer state
 * (theme, search, layout) lives in `viewerStore.ts`.
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { FlowEdge, FlowNode } from '../domain';
import type { AppPhase } from './appTypes';
import type { ParseDiagnosticPayload } from '../infrastructure';

/**
 * Tracks how many files have been processed by the web worker,
 * enabling the progress bar UI to display live feedback during long parses.
 */
export type ParseProgress = {
  doneFiles: number;
  totalFiles: number;
  currentFile: string;
};

/**
 * Controls whether dialogue lines are captured per-node during parsing:
 * - `'full'`: capture full text of each line (allows full-text search).
 * - `'countOnly'`: only record how many lines exist (lower memory, better for large projects).
 * - `'auto'`: let the upload orchestrator decide based on project size.
 */
export type DialogueSearchMode = 'auto' | 'full' | 'countOnly';

/**
 * Core application state managed by `useAppStore`.
 * `phase` drives which screen is shown by the App shell.
 * `importRevision` is incremented on every successful parse to force
 * the `FlowchartViewer` to remount and reset its session state.
 */
export interface AppState {
  phase: AppPhase;
  flowNodes: FlowNode[];
  flowEdges: FlowEdge[];
  parseDiagnostics: ParseDiagnosticPayload[];
  errorMsg: string;
  fileCount: number;
  parseProgress: ParseProgress | null;
  importRevision: number;
  dialogueSearchMode: DialogueSearchMode;
}

/**
 * Mutating actions available on the app store.
 * Each action corresponds to a distinct lifecycle transition:
 * `idle` → `reading` → `parsing` → `done` (or `error` at any step).
 */
export interface AppActions {
  reset: () => void;
  /** Transitions to 'reading' and initialises progress tracking. */
  startReading: (fileCount: number) => void;
  /** Transitions to 'parsing' after all files have been read. */
  startParsing: () => void;
  /** Updates the worker progress indicator during a parse run. */
  setProgress: (progress: ParseProgress) => void;
  /**
   * Stores intermediate parse results so the UI can display a partial graph
   * while the worker continues processing remaining files.
   */
  partialParseSuccess: (nodes: FlowNode[], edges: FlowEdge[], diagnostics?: ParseDiagnosticPayload[]) => void;
  /** Finalises the parse, bumps importRevision, and transitions to 'done'. */
  parseSuccess: (nodes: FlowNode[], edges: FlowEdge[], diagnostics?: ParseDiagnosticPayload[]) => void;
  setDialogueSearchMode: (mode: DialogueSearchMode) => void;
  /** Transitions to 'error' and stores a human-readable error message. */
  fail: (message: string) => void;
}

export type AppStore = AppState & AppActions;

const initialState: AppState = {
  phase: 'idle',
  flowNodes: [],
  flowEdges: [],
  parseDiagnostics: [],
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

    partialParseSuccess: (nodes, edges, diagnostics) =>
      set((draft) => {
        draft.phase = 'parsing';
        draft.flowNodes = nodes;
        draft.flowEdges = edges;
        if (diagnostics !== undefined) {
          draft.parseDiagnostics = diagnostics;
        }
      }),

    parseSuccess: (nodes, edges, diagnostics) =>
      set((draft) => {
        draft.phase = 'done';
        draft.flowNodes = nodes;
        draft.flowEdges = edges;
        draft.parseDiagnostics = diagnostics ?? [];
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
