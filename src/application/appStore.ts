/**
 * src/application/appStore.ts
 *
 * Zustand store for global import/parse lifecycle state.
 * Composed of modular single-responsibility slices:
 * - appPhaseSlice: lifecycle transitions and error handling
 * - appGraphSlice: graph nodes, edges, diagnostics, and revision tracking
 * - appProgressSlice: parsing progress updates and search mode configurations
 */

import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import type { FlowEdge, FlowNode } from "../domain/index.ts";
import type { AppPhase } from "./appTypes.ts";
import type { ParseDiagnosticPayload } from "../infrastructure/index.ts";
import type { ParseProgress } from "../parser/index.ts";
import {
  createAppGraphSlice,
  createAppPhaseSlice,
  createAppProgressSlice,
  type DialogueSearchMode,
} from "./appStoreSlices/index.ts";

export type { DialogueSearchMode, ParseProgress };

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
  translations: import("../domain/index.ts").ProjectTranslations | null;
  availableLanguages: string[];
}

export interface AppActions {
  updateNodeDetails: (
    details: Record<
      string,
      {
        dialogueLines?: string[];
        dialogueLineNums?: number[];
        audioAssetCues?: import("../domain/index.ts").AudioAssetCue[];
      }
    >,
  ) => void;
  reset: () => void;
  startReading: (fileCount: number) => void;
  startParsing: () => void;
  setProgress: (progress: ParseProgress) => void;
  partialParseSuccess: (
    nodes: FlowNode[],
    edges: FlowEdge[],
    diagnostics?: ParseDiagnosticPayload[],
  ) => void;
  parseSuccess: (
    nodes: FlowNode[],
    edges: FlowEdge[],
    diagnostics?: ParseDiagnosticPayload[],
    translations?: import("../domain/index.ts").ProjectTranslations | null,
  ) => void;
  setTranslations: (
    translations: import("../domain/index.ts").ProjectTranslations | null,
  ) => void;
  setDialogueSearchMode: (mode: DialogueSearchMode) => void;
  fail: (message: string) => void;
}

export type AppStore = AppState & AppActions;

export const useAppStore = create<AppStore>()(
  immer((set, get, api) => ({
    ...createAppPhaseSlice(set, get, api),
    ...createAppGraphSlice(set, get, api),
    ...createAppProgressSlice(set, get, api),
  })),
);
