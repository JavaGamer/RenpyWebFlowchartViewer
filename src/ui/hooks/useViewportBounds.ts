import { useCallback, useEffect, useState } from "react";
import type { ReactFlowInstance } from "@xyflow/react";
import type { AABB } from "../../infrastructure/index.ts";
import type { CanvasEdge, CanvasNode } from "../../domain/index.ts";

export interface UseViewportBoundsResult {
  bounds: AABB | null;
  updateBounds: () => void;
}

export function useViewportBounds(
  flowRef: React.RefObject<HTMLDivElement | null>,
  flowInstanceRef: React.MutableRefObject<
    ReactFlowInstance<CanvasNode, CanvasEdge> | null
  >,
  bufferPx = 400,
): UseViewportBoundsResult {
  const [bounds, setBounds] = useState<AABB | null>(null);

  const updateBounds = useCallback(() => {
    const instance = flowInstanceRef.current;
    const container = flowRef.current;
    if (!instance || !container || typeof instance.getViewport !== "function") {
      return;
    }

    const viewport = instance.getViewport();
    const width = container.clientWidth;
    const height = container.clientHeight;

    if (!width || !height) {
      setBounds(null);
      return;
    }

    const zoom = viewport.zoom || 1;
    const minX = (-viewport.x - bufferPx) / zoom;
    const minY = (-viewport.y - bufferPx) / zoom;
    const maxX = (-viewport.x + width + bufferPx) / zoom;
    const maxY = (-viewport.y + height + bufferPx) / zoom;

    setBounds((prev) => {
      if (
        prev &&
        Math.abs(prev.minX - minX) < 10 &&
        Math.abs(prev.minY - minY) < 10 &&
        Math.abs(prev.maxX - maxX) < 10 &&
        Math.abs(prev.maxY - maxY) < 10
      ) {
        return prev;
      }
      return { minX, minY, maxX, maxY };
    });
  }, [flowRef, flowInstanceRef, bufferPx]);

  useEffect(() => {
    let animationFrameId: number | null = null;

    const updateBounds = () => {
      const instance = flowInstanceRef.current;
      const container = flowRef.current;
      if (
        !instance || !container || typeof instance.getViewport !== "function"
      ) return;

      const viewport = instance.getViewport();
      const width = container.clientWidth;
      const height = container.clientHeight;

      if (!width || !height) {
        setBounds(null);
        return;
      }

      const zoom = viewport.zoom || 1;
      const minX = (-viewport.x - bufferPx) / zoom;
      const minY = (-viewport.y - bufferPx) / zoom;
      const maxX = (-viewport.x + width + bufferPx) / zoom;
      const maxY = (-viewport.y + height + bufferPx) / zoom;

      setBounds((prev) => {
        if (
          prev &&
          Math.abs(prev.minX - minX) < 10 &&
          Math.abs(prev.minY - minY) < 10 &&
          Math.abs(prev.maxX - maxX) < 10 &&
          Math.abs(prev.maxY - maxY) < 10
        ) {
          return prev;
        }
        return { minX, minY, maxX, maxY };
      });
    };

    const handleViewportChange = () => {
      if (animationFrameId !== null) return;
      animationFrameId = requestAnimationFrame(() => {
        animationFrameId = null;
        updateBounds();
      });
    };

    updateBounds();

    const container = flowRef.current;
    if (!container) return;

    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(() => {
        handleViewportChange();
      });
      observer.observe(container);
    }

    globalThis.addEventListener("resize", handleViewportChange);

    return () => {
      if (animationFrameId !== null) {
        cancelAnimationFrame(animationFrameId);
      }
      if (observer) {
        observer.disconnect();
      }
      globalThis.removeEventListener("resize", handleViewportChange);
    };
  }, [flowRef, flowInstanceRef, bufferPx]);

  return { bounds, updateBounds };
}
