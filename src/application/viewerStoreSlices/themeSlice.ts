/**
 * src/application/viewerStoreSlices/themeSlice.ts
 *
 * Persisted display-preference state: theme selection, call-return edge
 * visibility, audio-asset cue visibility, and per-edge-kind filters.
 */

import type { StateCreator } from "zustand";
import type {
  EdgeKindFilter,
  LayoutDensity,
  ThemeName,
} from "../../domain/index.ts";
import type { ViewerStore } from "../viewerStore.ts";
import {
  type DebugBundlePrivacyOptions,
  DEFAULT_DEBUG_BUNDLE_PRIVACY_OPTIONS,
} from "../debugBundle.ts";

// ─── State ────────────────────────────────────────────────────────────────────

export interface ThemeSliceState {
  theme: ThemeName;
  layoutDensity: LayoutDensity;
  showCallReturns: boolean;
  showAudioAssetCues: boolean;
  showMediaCuesInDialogue: boolean;
  showPacingHeatmap: boolean;
  minimapPannable: boolean;
  minimapZoomable: boolean;
  visibleEdgeKinds: Record<EdgeKindFilter, boolean>;
  simplifyCollapseLinearChains: boolean;
  simplifyInlineUtilities: boolean;
  simplifyInlineDetours: boolean;
  simplifyInlineStateToggles: boolean;
  simplifyInlineEmptyLabels: boolean;
  simplifyInlineDialogueThreshold: number;
  debugPrivacyOptions: DebugBundlePrivacyOptions;
  /** Reading speed in words per minute used for reading time calculations. */
  readingSpeedWpm: number;
}

// ─── Actions ──────────────────────────────────────────────────────────────────

export interface ThemeSliceActions {
  setTheme: (theme: ThemeName) => void;
  setLayoutDensity: (density: LayoutDensity) => void;
  setShowCallReturns: (show: boolean) => void;
  setShowAudioAssetCues: (show: boolean) => void;
  setShowMediaCuesInDialogue: (show: boolean) => void;
  setShowPacingHeatmap: (show: boolean) => void;
  setMinimapPannable: (pannable: boolean) => void;
  setMinimapZoomable: (zoomable: boolean) => void;
  setEdgeKindVisible: (kind: EdgeKindFilter, visible: boolean) => void;
  setSimplifyCollapseLinearChains: (collapse: boolean) => void;
  setSimplifyInlineUtilities: (inline: boolean) => void;
  setSimplifyInlineDetours: (inline: boolean) => void;
  setSimplifyInlineStateToggles: (inline: boolean) => void;
  setSimplifyInlineEmptyLabels: (inline: boolean) => void;
  setSimplifyInlineDialogueThreshold: (threshold: number) => void;
  setDebugPrivacyOptions: (options: DebugBundlePrivacyOptions) => void;
  updateDebugPrivacyOptions: (
    patch: Partial<DebugBundlePrivacyOptions>,
  ) => void;
  /** Sets the reading speed in words per minute. Clamped to 100–400. */
  setReadingSpeedWpm: (wpm: number) => void;
}

export type ThemeSlice = ThemeSliceState & ThemeSliceActions;

// ─── Defaults ─────────────────────────────────────────────────────────────────

export const defaultThemeState: ThemeSliceState = {
  theme: "violet",
  layoutDensity: "normal",
  showCallReturns: false,
  showAudioAssetCues: true,
  showMediaCuesInDialogue: false,
  showPacingHeatmap: false,
  minimapPannable: true,
  minimapZoomable: true,
  visibleEdgeKinds: {
    sequence: true,
    jump: true,
    call: true,
    call_return: true,
  },
  simplifyCollapseLinearChains: false,
  simplifyInlineUtilities: false,
  simplifyInlineDetours: false,
  simplifyInlineStateToggles: false,
  simplifyInlineEmptyLabels: false,
  simplifyInlineDialogueThreshold: 1,
  debugPrivacyOptions: DEFAULT_DEBUG_BUNDLE_PRIVACY_OPTIONS,
  readingSpeedWpm: 200,
};

// ─── Slice creator ────────────────────────────────────────────────────────────

export const createThemeSlice: StateCreator<
  ViewerStore,
  [["zustand/immer", never]],
  [],
  ThemeSlice
> = (set) => ({
  ...defaultThemeState,

  setTheme: (theme) =>
    set((draft) => {
      draft.theme = theme;
    }),

  setLayoutDensity: (density) =>
    set((draft) => {
      draft.layoutDensity = density;
    }),

  setShowCallReturns: (show) =>
    set((draft) => {
      draft.showCallReturns = show;
    }),

  setShowAudioAssetCues: (show) =>
    set((draft) => {
      draft.showAudioAssetCues = show;
    }),

  setShowMediaCuesInDialogue: (show) =>
    set((draft) => {
      draft.showMediaCuesInDialogue = show;
    }),

  setShowPacingHeatmap: (show) =>
    set((draft) => {
      draft.showPacingHeatmap = show;
    }),

  setMinimapPannable: (pannable) =>
    set((draft) => {
      draft.minimapPannable = pannable;
    }),

  setMinimapZoomable: (zoomable) =>
    set((draft) => {
      draft.minimapZoomable = zoomable;
    }),

  setEdgeKindVisible: (kind, visible) =>
    set((draft) => {
      draft.visibleEdgeKinds[kind] = visible;
    }),

  setSimplifyCollapseLinearChains: (collapse) =>
    set((draft) => {
      draft.simplifyCollapseLinearChains = collapse;
    }),

  setSimplifyInlineUtilities: (inline) =>
    set((draft) => {
      draft.simplifyInlineUtilities = inline;
    }),

  setSimplifyInlineDetours: (inline) =>
    set((draft) => {
      draft.simplifyInlineDetours = inline;
    }),

  setSimplifyInlineStateToggles: (inline) =>
    set((draft) => {
      draft.simplifyInlineStateToggles = inline;
    }),

  setSimplifyInlineEmptyLabels: (inline) =>
    set((draft) => {
      draft.simplifyInlineEmptyLabels = inline;
    }),

  setSimplifyInlineDialogueThreshold: (threshold) =>
    set((draft) => {
      draft.simplifyInlineDialogueThreshold = threshold;
    }),

  setDebugPrivacyOptions: (options) =>
    set((draft) => {
      draft.debugPrivacyOptions = options;
    }),

  updateDebugPrivacyOptions: (patch) =>
    set((draft) => {
      draft.debugPrivacyOptions = {
        ...draft.debugPrivacyOptions,
        ...patch,
      };
    }),

  setReadingSpeedWpm: (wpm) =>
    set((draft) => {
      draft.readingSpeedWpm = Math.max(100, Math.min(400, Math.round(wpm)));
    }),
});
