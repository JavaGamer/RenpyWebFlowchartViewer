/**
 * src/application/viewerStoreSlices/filterSlice.ts
 *
 * Session state for graph filtering and layout controls: layout direction,
 * minimum-dialogue threshold, collapsed chapters/parent-labels, advanced
 * controls, large-graph-mode override, label subgraph search, and condition
 * visibility mode.
 */

import type { StateCreator } from "zustand";
import type {
  ConditionVisibilityMode,
  LayoutDirection,
} from "../../domain/index.ts";
import type { ViewerStore } from "../viewerStore.ts";

// ─── State ────────────────────────────────────────────────────────────────────

export interface FilterSliceState {
  layoutDirection: LayoutDirection;
  minDialogue: number;
  collapsedChapters: Record<string, boolean>;
  collapsedParentLabels: Record<string, boolean>;
  largeGraphModeOverride: boolean | null;
  showAdvancedControls: boolean;
  showAllLabelSubgraphToggles: boolean;
  labelSubgraphSearchInput: string;
  conditionVisibilityMode: ConditionVisibilityMode;
}

// ─── Actions ──────────────────────────────────────────────────────────────────

export interface FilterSliceActions {
  setLayoutDirection: (direction: LayoutDirection) => void;
  setMinDialogue: (value: number) => void;
  toggleChapter: (chapter: string) => void;
  toggleParentLabel: (label: string) => void;
  setAllParentLabelsCollapsed: (labels: string[], collapsed: boolean) => void;
  setLargeGraphModeOverride: (value: boolean | null) => void;
  toggleShowAdvancedControls: () => void;
  setShowAdvancedControls: (show: boolean) => void;
  toggleShowAllLabelSubgraphToggles: () => void;
  setLabelSubgraphSearchInput: (value: string) => void;
  setConditionVisibilityMode: (mode: ConditionVisibilityMode) => void;
}

export type FilterSlice = FilterSliceState & FilterSliceActions;

// ─── Defaults ─────────────────────────────────────────────────────────────────

export const defaultFilterState: FilterSliceState = {
  layoutDirection: "TB",
  minDialogue: 0,
  collapsedChapters: {},
  collapsedParentLabels: {},
  largeGraphModeOverride: null,
  showAdvancedControls: false,
  showAllLabelSubgraphToggles: false,
  labelSubgraphSearchInput: "",
  conditionVisibilityMode: "fade",
};

// ─── Slice creator ────────────────────────────────────────────────────────────

export const createFilterSlice: StateCreator<
  ViewerStore,
  [["zustand/immer", never]],
  [],
  FilterSlice
> = (set) => ({
  ...defaultFilterState,

  setLayoutDirection: (direction) =>
    set((draft) => {
      draft.layoutDirection = direction;
    }),

  setMinDialogue: (value) =>
    set((draft) => {
      draft.minDialogue = value;
    }),

  toggleChapter: (chapter) =>
    set((draft) => {
      draft.collapsedChapters[chapter] = !draft.collapsedChapters[chapter];
    }),

  toggleParentLabel: (label) =>
    set((draft) => {
      draft.collapsedParentLabels[label] = !draft.collapsedParentLabels[label];
    }),

  setAllParentLabelsCollapsed: (labels, collapsed) =>
    set((draft) => {
      for (const label of labels) {
        draft.collapsedParentLabels[label] = collapsed;
      }
    }),

  setLargeGraphModeOverride: (value) =>
    set((draft) => {
      draft.largeGraphModeOverride = value;
    }),

  toggleShowAdvancedControls: () =>
    set((draft) => {
      draft.showAdvancedControls = !draft.showAdvancedControls;
    }),

  setShowAdvancedControls: (show) =>
    set((draft) => {
      draft.showAdvancedControls = show;
    }),

  toggleShowAllLabelSubgraphToggles: () =>
    set((draft) => {
      draft.showAllLabelSubgraphToggles = !draft.showAllLabelSubgraphToggles;
    }),

  setLabelSubgraphSearchInput: (value) =>
    set((draft) => {
      draft.labelSubgraphSearchInput = value;
    }),

  setConditionVisibilityMode: (mode) =>
    set((draft) => {
      draft.conditionVisibilityMode = mode;
    }),
});
