/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useContext, useMemo } from "react";
import type { LayoutDirection } from "../domain/index.ts";

export interface ViewerPresentationState {
  searchInput: string;
  readingSpeedWpm: number;
  layoutDirection: LayoutDirection;
  showAudioAssetCues: boolean;
  showPacingHeatmap: boolean;
  isLod: boolean;
}

import { useViewerStore } from "../application/index.ts";

const DEFAULT_PRESENTATION_STATE: ViewerPresentationState = {
  searchInput: "",
  readingSpeedWpm: 200,
  layoutDirection: "TB",
  showAudioAssetCues: true,
  showPacingHeatmap: false,
  isLod: false,
};

export const ViewerPresentationContext = createContext<ViewerPresentationState>(
  DEFAULT_PRESENTATION_STATE,
);

export function useViewerPresentation(): ViewerPresentationState {
  const ctx = useContext(ViewerPresentationContext);
  if (ctx !== DEFAULT_PRESENTATION_STATE) {
    return ctx;
  }

  // Standalone test fallback using getState() (zero React subscriptions)
  const store = useViewerStore.getState();
  return {
    searchInput: store.searchInput ?? "",
    readingSpeedWpm: store.readingSpeedWpm ?? 200,
    layoutDirection: store.layoutDirection ?? "TB",
    showAudioAssetCues: store.showAudioAssetCues ?? true,
    showPacingHeatmap: store.showPacingHeatmap ?? false,
    isLod: ctx.isLod,
  };
}

export interface ViewerPresentationProviderProps {
  searchInput: string;
  readingSpeedWpm: number;
  layoutDirection: LayoutDirection;
  showAudioAssetCues: boolean;
  showPacingHeatmap: boolean;
  isLod: boolean;
  children: React.ReactNode;
}

export const ViewerLayoutContext = createContext<LayoutDirection>("TB");

export function useViewerLayoutDirection(): LayoutDirection {
  const dir = useContext(ViewerLayoutContext);
  if (dir) return dir;
  const store = useViewerStore.getState();
  return store.layoutDirection ?? "TB";
}

export function ViewerPresentationProvider({
  searchInput,
  readingSpeedWpm,
  layoutDirection,
  showAudioAssetCues,
  showPacingHeatmap,
  isLod,
  children,
}: ViewerPresentationProviderProps) {
  const value = useMemo(
    () => ({
      searchInput,
      readingSpeedWpm,
      layoutDirection,
      showAudioAssetCues,
      showPacingHeatmap,
      isLod,
    }),
    [
      searchInput,
      readingSpeedWpm,
      layoutDirection,
      showAudioAssetCues,
      showPacingHeatmap,
      isLod,
    ],
  );

  return (
    <ViewerLayoutContext.Provider value={layoutDirection}>
      <ViewerPresentationContext.Provider value={value}>
        {children}
      </ViewerPresentationContext.Provider>
    </ViewerLayoutContext.Provider>
  );
}
