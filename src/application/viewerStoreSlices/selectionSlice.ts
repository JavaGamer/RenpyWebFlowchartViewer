/**
 * src/application/viewerStoreSlices/selectionSlice.ts
 *
 * Session state for node selection and focus: the currently-focused node,
 * the selected node in the inspector, the selected dialogue line index,
 * and the show-all-inspector-lines toggle.
 */

import type { StateCreator } from "zustand";
import type { ViewerStore } from "../viewerStoreTypes.ts";

// ─── State ────────────────────────────────────────────────────────────────────

export interface SelectionSliceState {
  focusNodeId: string;
  selectedNodeId: string;
  selectedDialogueLineIndex: number | null;
  showAllInspectorLines: boolean;
  pathStartNodeId: string | null;
  pathTargetNodeId: string | null;
}

// ─── Actions ──────────────────────────────────────────────────────────────────

export interface SelectionSliceActions {
  setFocusNodeId: (id: string) => void;
  setSelectedNodeId: (id: string) => void;
  setSelectedDialogueLineIndex: (index: number | null) => void;
  toggleShowAllInspectorLines: () => void;
  setShowAllInspectorLines: (show: boolean) => void;
  setPathStartNodeId: (id: string | null) => void;
  setPathTargetNodeId: (id: string | null) => void;
}

export type SelectionSlice = SelectionSliceState & SelectionSliceActions;

// ─── Defaults ─────────────────────────────────────────────────────────────────

export const defaultSelectionState: SelectionSliceState = {
  focusNodeId: "",
  selectedNodeId: "",
  selectedDialogueLineIndex: null,
  showAllInspectorLines: false,
  pathStartNodeId: null,
  pathTargetNodeId: null,
};

// ─── Slice creator ────────────────────────────────────────────────────────────

export const createSelectionSlice: StateCreator<
  ViewerStore,
  [["zustand/immer", never]],
  [],
  SelectionSlice
> = (set) => ({
  ...defaultSelectionState,

  setFocusNodeId: (id) =>
    set((draft) => {
      draft.focusNodeId = id;
    }),

  setSelectedNodeId: (id) =>
    set((draft) => {
      draft.selectedNodeId = id;
      draft.selectedDialogueLineIndex = null;
    }),

  setSelectedDialogueLineIndex: (index) =>
    set((draft) => {
      draft.selectedDialogueLineIndex = index;
    }),

  toggleShowAllInspectorLines: () =>
    set((draft) => {
      draft.showAllInspectorLines = !draft.showAllInspectorLines;
    }),

  setShowAllInspectorLines: (show) =>
    set((draft) => {
      draft.showAllInspectorLines = show;
    }),

  setPathStartNodeId: (id) =>
    set((draft) => {
      draft.pathStartNodeId = id;
    }),

  setPathTargetNodeId: (id) =>
    set((draft) => {
      draft.pathTargetNodeId = id;
    }),
});
