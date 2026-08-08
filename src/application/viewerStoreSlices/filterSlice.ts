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
import type { ViewerStore } from "../viewerStoreTypes.ts";
import { useAppStore } from "../appStore.ts";
import { useViewerStore } from "../viewerStore.ts";

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

  toggleChapter: (chapter) => {
    let nodesToFetch: string[] = [];
    set((draft) => {
      const willBeCollapsed = !draft.collapsedChapters[chapter];
      draft.collapsedChapters[chapter] = willBeCollapsed;
      if (!willBeCollapsed) {
        nodesToFetch = useAppStore.getState().flowNodes.filter(
          (n) => n.chapter === chapter && !n.isDetailsLoaded,
        ).map((n) => n.id);
      }
    });
    if (nodesToFetch.length > 0) {
      useViewerStore.getState().fetchNodeDetails(nodesToFetch).catch(
        () => {},
      );
    }
  },

  toggleParentLabel: (label) => {
    let nodesToFetch: string[] = [];
    set((draft) => {
      const willBeCollapsed = !draft.collapsedParentLabels[label];
      draft.collapsedParentLabels[label] = willBeCollapsed;
      if (!willBeCollapsed) {
        nodesToFetch = useAppStore.getState().flowNodes.filter(
          (n) =>
            (n.parentLabelId === label || n.label === label) &&
            !n.isDetailsLoaded,
        ).map((n) => n.id);
      }
    });
    if (nodesToFetch.length > 0) {
      useViewerStore.getState().fetchNodeDetails(nodesToFetch).catch(
        () => {},
      );
    }
  },

  setAllParentLabelsCollapsed: (labels, collapsed) => {
    let nodesToFetch: string[] = [];
    set((draft) => {
      for (const label of labels) {
        draft.collapsedParentLabels[label] = collapsed;
      }
      if (!collapsed) {
        const labelSet = new Set(labels);
        nodesToFetch = useAppStore.getState().flowNodes.filter(
          (n) =>
            ((n.parentLabelId && labelSet.has(n.parentLabelId)) ||
              labelSet.has(n.label)) &&
            !n.isDetailsLoaded,
        ).map((n) => n.id);
      }
    });
    if (nodesToFetch.length > 0) {
      useViewerStore.getState().fetchNodeDetails(nodesToFetch).catch(
        () => {},
      );
    }
  },

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
