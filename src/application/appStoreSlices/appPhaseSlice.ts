import type { StateCreator } from "zustand";
import type { AppPhase } from "../appTypes.ts";
import type { AppStore } from "../appStore.ts";
import { clearUploadedFilesCache } from "../uploadCache.ts";

export type DialogueSearchMode = "auto" | "full" | "countOnly";

export interface AppPhaseState {
  phase: AppPhase;
  errorMsg: string;
  isReparsing: boolean;
}

export interface AppPhaseActions {
  reset: () => void;
  startReading: (fileCount: number) => void;
  startParsing: () => void;
  setIsReparsing: (isReparsing: boolean) => void;
  fail: (message: string) => void;
}

export type AppPhaseSlice = AppPhaseState & AppPhaseActions;

export const defaultAppPhaseState: AppPhaseState = {
  phase: "idle",
  errorMsg: "",
  isReparsing: false,
};

export const createAppPhaseSlice: StateCreator<
  AppStore,
  [["zustand/immer", never]],
  [],
  AppPhaseSlice
> = (set) => ({
  ...defaultAppPhaseState,

  reset: () => {
    clearUploadedFilesCache();
    set((draft) => {
      draft.phase = "idle";
      draft.isReparsing = false;
      draft.flowNodes = [];
      draft.flowEdges = [];
      draft.parseDiagnostics = [];
      draft.errorMsg = "";
      draft.fileCount = 0;
      draft.parseProgress = null;
      draft.dialogueSearchMode = "auto";
      draft.translations = null;
      draft.availableLanguages = [];
      draft.parsedVariant = null;
      draft.isVariantAutoDetected = false;
    });
  },

  startReading: (fileCount) =>
    set((draft) => {
      draft.phase = "reading";
      draft.isReparsing = false;
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

  setIsReparsing: (isReparsing) =>
    set((draft) => {
      draft.isReparsing = isReparsing;
    }),

  fail: (message) =>
    set((draft) => {
      draft.phase = "error";
      draft.isReparsing = false;
      draft.errorMsg = message;
      draft.parseProgress = null;
      draft.flowNodes = [];
      draft.flowEdges = [];
      draft.parseDiagnostics = [];
    }),
});
