import type { StateCreator } from "zustand";
import type { ParseProgress } from "../../parser/index.ts";
import type { AppStore, DialogueSearchMode } from "../appStore.ts";

export interface AppProgressState {
  fileCount: number;
  parseProgress: ParseProgress | null;
  dialogueSearchMode: DialogueSearchMode;
}

export interface AppProgressActions {
  setProgress: (progress: ParseProgress) => void;
  setDialogueSearchMode: (mode: DialogueSearchMode) => void;
}

export type AppProgressSlice = AppProgressState & AppProgressActions;

export const defaultAppProgressState: AppProgressState = {
  fileCount: 0,
  parseProgress: null,
  dialogueSearchMode: "auto",
};

export const createAppProgressSlice: StateCreator<
  AppStore,
  [["zustand/immer", never]],
  [],
  AppProgressSlice
> = (set) => ({
  ...defaultAppProgressState,

  setProgress: (progress) =>
    set((draft) => {
      draft.parseProgress = progress;
    }),

  setDialogueSearchMode: (mode) =>
    set((draft) => {
      draft.dialogueSearchMode = mode;
    }),
});
