/**
 * src/application/viewerStoreSlices/themeSlice.ts
 *
 * Persisted display-preference state: theme selection, call-return edge
 * visibility, audio-asset cue visibility, and per-edge-kind filters.
 */

import type { StateCreator } from 'zustand';
import type { EdgeKindFilter, ThemeName, LayoutDensity } from '../../domain';
import type { ViewerStore } from '../viewerStore';

// ─── State ────────────────────────────────────────────────────────────────────

export interface ThemeSliceState {
  theme: ThemeName;
  layoutDensity: LayoutDensity;
  showCallReturns: boolean;
  showAudioAssetCues: boolean;
  visibleEdgeKinds: Record<EdgeKindFilter, boolean>;
}

// ─── Actions ──────────────────────────────────────────────────────────────────

export interface ThemeSliceActions {
  setTheme: (theme: ThemeName) => void;
  setLayoutDensity: (density: LayoutDensity) => void;
  setShowCallReturns: (show: boolean) => void;
  setShowAudioAssetCues: (show: boolean) => void;
  setEdgeKindVisible: (kind: EdgeKindFilter, visible: boolean) => void;
}

export type ThemeSlice = ThemeSliceState & ThemeSliceActions;

// ─── Defaults ─────────────────────────────────────────────────────────────────

export const defaultThemeState: ThemeSliceState = {
  theme: 'violet',
  layoutDensity: 'normal',
  showCallReturns: false,
  showAudioAssetCues: true,
  visibleEdgeKinds: {
    sequence: true,
    jump: true,
    call: true,
    call_return: true,
  },
};

// ─── Slice creator ────────────────────────────────────────────────────────────

export const createThemeSlice: StateCreator<
  ViewerStore,
  [['zustand/immer', never]],
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

  setEdgeKindVisible: (kind, visible) =>
    set((draft) => {
      draft.visibleEdgeKinds[kind] = visible;
    }),
});
