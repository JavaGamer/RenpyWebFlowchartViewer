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
  selectedDialogueLineIndex: number | null;
  showAllInspectorLines: boolean;
  selectedCallContextId: string | null;
  loadingNodeDetailIds: Set<string>;
  hydratedNodeDetailIds: Set<string>;
}

// ─── Actions ──────────────────────────────────────────────────────────────────

export interface SelectionSliceActions {
  fetchNodeDetails: (nodeIds: string[]) => Promise<void>;
  setFocusNodeId: (id: string) => void;
  setSelectedNodeId: (id: string) => void;
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

  setFocusNodeId: (id) =>
    set((draft) => {
      draft.focusNodeId = id;
    }),

  setSelectedNodeId: (id) =>
    set((draft) => {
      draft.selectedNodeId = id;
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
