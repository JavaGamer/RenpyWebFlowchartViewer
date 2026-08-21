import type { StateCreator } from "zustand";
import type {
  AnalyticsSliceActions,
  AnalyticsSliceState,
  ViewerStore,
} from "../viewerStoreTypes.ts";

export const initialAnalyticsState: AnalyticsSliceState = {
  isAnalyticsModalOpen: false,
  activeAnalyticsTab: "overview",
  highlightedRoute: null,
  customEndingTags: {},
  cachedAnalyticsReport: null,
};

export const createAnalyticsSlice: StateCreator<
  ViewerStore,
  [["zustand/immer", never]],
  [],
  AnalyticsSliceState & AnalyticsSliceActions
> = (set) => ({
  ...initialAnalyticsState,

  setAnalyticsModalOpen: (open) =>
    set((draft) => {
      draft.isAnalyticsModalOpen = open;
    }),

  setActiveAnalyticsTab: (tab) =>
    set((draft) => {
      draft.activeAnalyticsTab = tab;
    }),

  setHighlightedRoute: (route) =>
    set((draft) => {
      draft.highlightedRoute = route;
    }),

  clearHighlightedRoute: () =>
    set((draft) => {
      draft.highlightedRoute = null;
    }),

  setCustomEndingTag: (nodeId, endingType) =>
    set((draft) => {
      draft.customEndingTags[nodeId] = endingType;
      // Invalidate cached report when custom ending tag changes
      draft.cachedAnalyticsReport = null;
    }),

  setCachedAnalyticsReport: (report) =>
    set((draft) => {
      draft.cachedAnalyticsReport = report;
    }),
});
