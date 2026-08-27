import { type ReactFlowState, useStore } from "@xyflow/react";
import { useViewerStore } from "../../application/index.ts";
import { LOD_ZOOM_THRESHOLD } from "../../config/viewerConfig.ts";
import { useViewerPresentation } from "../viewerContext.tsx";

/**
 * Top-level hook for FlowchartCanvas to determine if LOD simplification is active.
 */
export function useCanvasLodMode(): boolean {
  const enableLodZooming = useViewerStore((s) => s.enableLodZooming);

  const isZoomLow = useStore((s: ReactFlowState) => {
    const zoom = typeof s?.transform?.[2] === "number" ? s.transform[2] : 1;
    return zoom < LOD_ZOOM_THRESHOLD;
  });

  return Boolean(enableLodZooming && isZoomLow);
}

/**
 * Hook that determines if Level of Detail (LOD) node simplification is active.
 *
 * Purely consumes from ViewerPresentationContext with zero per-node store subscriptions.
 */
export function useIsLodMode(): boolean {
  return useViewerPresentation().isLod;
}
