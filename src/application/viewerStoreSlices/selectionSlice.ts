/**
 * src/application/viewerStoreSlices/selectionSlice.ts
 *
 * Session state for node selection and focus: the currently-focused node,
 * the selected node in the inspector, the selected dialogue line index,
 * and the show-all-inspector-lines toggle.
 */

import type { StateCreator } from "zustand";
import type { ViewerStore } from "../viewerStoreTypes.ts";
import { extractNodeDetailsInWorker } from "../../infrastructure/index.ts";
import { useAppStore } from "../appStore.ts";

// ─── State ────────────────────────────────────────────────────────────────────

export interface SelectionSliceState {
  focusNodeId: string;
  selectedNodeId: string;
  selectedNodeIds: string[];
  isBoxSelectionActive: boolean;
  isolatedSubgraphNodeIds: string[] | null;
  selectedDialogueLineIndex: number | null;
  showAllInspectorLines: boolean;
  selectedCallContextId: string | null;
  loadingNodeDetailIds: Set<string>;
  hydratedNodeDetailIds: Set<string>;
}

// ─── Actions ──────────────────────────────────────────────────────────────────

export interface SelectionSliceActions {
  fetchNodeDetails: (nodeIds: string[]) => Promise<void>;
  markNodesHydrated: (ids: string[]) => void;
  setFocusNodeId: (id: string) => void;
  setSelectedNodeId: (id: string) => void;
  setSelectedNodeIds: (ids: string[]) => void;
  toggleBoxSelectionMode: () => void;
  setBoxSelectionMode: (active: boolean) => void;
  setIsolatedSubgraphNodeIds: (ids: string[] | null) => void;
  clearMultiSelection: () => void;
  setSelectedDialogueLineIndex: (index: number | null) => void;
  toggleShowAllInspectorLines: () => void;
  setShowAllInspectorLines: (show: boolean) => void;
  setSelectedCallContextId: (id: string | null) => void;
  clearCallContextHighlight: () => void;
}

export type SelectionSlice = SelectionSliceState & SelectionSliceActions;

// ─── Defaults ─────────────────────────────────────────────────────────────────

export function createDefaultSelectionState(): SelectionSliceState {
  return {
    focusNodeId: "",
    selectedNodeId: "",
    selectedNodeIds: [],
    isBoxSelectionActive: false,
    isolatedSubgraphNodeIds: null,
    selectedDialogueLineIndex: null,
    showAllInspectorLines: false,
    selectedCallContextId: null,
    loadingNodeDetailIds: new Set<string>(),
    hydratedNodeDetailIds: new Set<string>(),
  };
}

export const defaultSelectionState: SelectionSliceState =
  createDefaultSelectionState();

// ─── Slice creator ────────────────────────────────────────────────────────────

export const createSelectionSlice: StateCreator<
  ViewerStore,
  [["zustand/immer", never]],
  [],
  SelectionSlice
> = (set, get) => ({
  ...createDefaultSelectionState(),

  fetchNodeDetails: async (nodeIds) => {
    const currentState = get();
    const toFetch = nodeIds.filter(
      (id) =>
        !currentState.loadingNodeDetailIds.has(id) &&
        !currentState.hydratedNodeDetailIds.has(id),
    );
    if (toFetch.length === 0) return;

    set((draft) => {
      const nextLoading = new Set(draft.loadingNodeDetailIds);
      toFetch.forEach((id) => nextLoading.add(id));
      draft.loadingNodeDetailIds = nextLoading;
    });

    try {
      const details = await extractNodeDetailsInWorker(toFetch);
      useAppStore.getState().updateNodeDetails(details);
      set((draft) => {
        const nextLoading = new Set(draft.loadingNodeDetailIds);
        const nextHydrated = new Set(draft.hydratedNodeDetailIds);
        toFetch.forEach((id) => {
          nextLoading.delete(id);
          nextHydrated.add(id);
        });
        draft.loadingNodeDetailIds = nextLoading;
        draft.hydratedNodeDetailIds = nextHydrated;
      });
    } catch {
      set((draft) => {
        const nextLoading = new Set(draft.loadingNodeDetailIds);
        toFetch.forEach((id) => {
          nextLoading.delete(id);
        });
        draft.loadingNodeDetailIds = nextLoading;
      });
    }
  },

  markNodesHydrated: (ids) =>
    set((draft) => {
      const nextHydrated = new Set(draft.hydratedNodeDetailIds);
      ids.forEach((id) => nextHydrated.add(id));
      draft.hydratedNodeDetailIds = nextHydrated;
    }),

  setFocusNodeId: (id) =>
    set((draft) => {
      draft.focusNodeId = id;
    }),

  setSelectedNodeId: (id) =>
    set((draft) => {
      draft.selectedNodeId = id;
      if (id && !draft.selectedNodeIds.includes(id)) {
        draft.selectedNodeIds = [id];
      } else if (!id) {
        draft.selectedNodeIds = [];
      }
    }),

  setSelectedNodeIds: (ids) =>
    set((draft) => {
      if (
        draft.selectedNodeIds.length === ids.length &&
        draft.selectedNodeIds.every((val, idx) => val === ids[idx])
      ) {
        return;
      }
      draft.selectedNodeIds = ids;
      if (ids.length === 1) {
        draft.selectedNodeId = ids[0]!;
      } else if (ids.length === 0) {
        draft.selectedNodeId = "";
      } else if (!ids.includes(draft.selectedNodeId)) {
        draft.selectedNodeId = ids[0]!;
      }
    }),

  toggleBoxSelectionMode: () =>
    set((draft) => {
      draft.isBoxSelectionActive = !draft.isBoxSelectionActive;
    }),

  setBoxSelectionMode: (active) =>
    set((draft) => {
      draft.isBoxSelectionActive = active;
    }),

  setIsolatedSubgraphNodeIds: (ids) =>
    set((draft) => {
      draft.isolatedSubgraphNodeIds = ids;
    }),

  clearMultiSelection: () =>
    set((draft) => {
      draft.selectedNodeIds = [];
      draft.selectedNodeId = "";
      draft.selectedDialogueLineIndex = null;
      draft.showAllInspectorLines = false;
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

  setSelectedCallContextId: (id) =>
    set((draft) => {
      draft.selectedCallContextId = id;
    }),

  clearCallContextHighlight: () =>
    set((draft) => {
      draft.selectedCallContextId = null;
    }),
});
