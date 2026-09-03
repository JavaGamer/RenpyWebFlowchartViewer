import type { StateCreator } from "zustand";
import type { AppPhase } from "../appTypes.ts";
import type { AppStore } from "../appStore.ts";

export type DialogueSearchMode = "auto" | "full" | "countOnly";

export interface AppPhaseState {
  phase: AppPhase;
  errorMsg: string;
}

export interface AppPhaseActions {
  reset: () => void;
  startReading: (fileCount: number) => void;
  startParsing: () => void;
  fail: (message: string) => void;
}

export type AppPhaseSlice = AppPhaseState & AppPhaseActions;

export const defaultAppPhaseState: AppPhaseState = {
  phase: "idle",
  errorMsg: "",
};

export const createAppPhaseSlice: StateCreator<
  AppStore,
  [["zustand/immer", never]],
  [],
  AppPhaseSlice
> = (set) => ({
  ...defaultAppPhaseState,

  reset: () =>
    set((draft) => {
      draft.phase = "idle";
      draft.flowNodes = [];
      draft.flowEdges = [];
      draft.parseDiagnostics = [];
      draft.errorMsg = "";
      draft.fileCount = 0;
      draft.parseProgress = null;
      draft.dialogueSearchMode = "auto";
      draft.translations = null;
      draft.availableLanguages = [];
    }),

  startReading: (fileCount) =>
    set((draft) => {
      draft.phase = "reading";
      draft.fileCount = fileCount;
      draft.errorMsg = "";
      draft.parseProgress = {
        doneFiles: 0,
        totalFiles: fileCount,
        currentFile: "",
      };
    }),

  startParsing: () =>
    set((draft) => {
      draft.phase = "parsing";
    }),

  fail: (message) =>
    set((draft) => {
      draft.phase = "error";
      draft.errorMsg = message;
      draft.parseProgress = null;
      draft.flowNodes = [];
      draft.flowEdges = [];
      draft.parseDiagnostics = [];
    }),
});
