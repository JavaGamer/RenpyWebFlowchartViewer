import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useEdgesState, useNodesState } from "@xyflow/react";
import {
  applyDagreLayout,
  type CanvasEdge,
  type CanvasNode,
  type FlowEdge,
  type FlowNode,
  type LayoutDensity,
  type LayoutDirection,
  PROGRESSIVE_LAYOUT_NODE_LIMIT,
} from "../../domain/index.ts";
import type { createPerfTracker } from "../../infrastructure/index.ts";
import {
  areWorkersSupported,
  runLayoutInWorker,
  terminateLayoutWorker,
} from "../../infrastructure/index.ts";

const globalRecord = globalThis as Record<string, unknown>;
const isTestEnv = typeof globalRecord["process"] !== "undefined" &&
  (globalRecord["process"] as { env?: { NODE_ENV?: string } } | undefined)?.env
      ?.NODE_ENV === "test";
const isWorkerSupported = areWorkersSupported();

type PerfTracker = ReturnType<typeof createPerfTracker>;

interface UseViewerLayoutParams {
  flowNodes: FlowNode[];
  flowEdges: FlowEdge[];
  layoutDirection: LayoutDirection;
  layoutDensity: LayoutDensity;
  perf: PerfTracker;
  onRelayoutComplete?: () => void;
}

export function useViewerLayout({
  flowNodes,
  flowEdges,
  layoutDirection,
  layoutDensity,
  perf,
  onRelayoutComplete,
}: UseViewerLayoutParams): {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  setNodes: ReturnType<typeof useNodesState<CanvasNode>>[1];
  setEdges: ReturnType<typeof useEdgesState<CanvasEdge>>[1];
  onNodesChange: ReturnType<typeof useNodesState<CanvasNode>>[2];
  onEdgesChange: ReturnType<typeof useEdgesState<CanvasEdge>>[2];
  nodePositionsRef: React.RefObject<Map<string, { x: number; y: number }>>;
  relayout: () => void;
  isCalculatingLayout: boolean;
} {
  const nodePositionsRef = useRef<Map<string, { x: number; y: number }>>(
    new Map(),
  );
  const shouldProgressiveLayout =
    flowNodes.length > PROGRESSIVE_LAYOUT_NODE_LIMIT;
  const isLargeWorkerEnabled = shouldProgressiveLayout && !isTestEnv &&
    isWorkerSupported;
  const [isCalculatingLayout, setIsCalculatingLayout] = useState(
    isLargeWorkerEnabled,
  );

  // Sync state with props changes during render phase to avoid effect layout shifts
  const [prevFlowNodes, setPrevFlowNodes] = useState(flowNodes);
  const [prevFlowEdges, setPrevFlowEdges] = useState(flowEdges);
  const [prevDirection, setPrevDirection] = useState(layoutDirection);
  const [prevDensity, setPrevDensity] = useState(layoutDensity);

  if (
    flowNodes !== prevFlowNodes ||
    flowEdges !== prevFlowEdges ||
    layoutDirection !== prevDirection ||
    layoutDensity !== prevDensity
  ) {
    setPrevFlowNodes(flowNodes);
    setPrevFlowEdges(flowEdges);
    setPrevDirection(layoutDirection);
    setPrevDensity(layoutDensity);
    setIsCalculatingLayout(
      flowNodes.length > PROGRESSIVE_LAYOUT_NODE_LIMIT && !isTestEnv &&
        isWorkerSupported,
    );
  }

  const { nodes: layoutNodes, edges: layoutEdges } = useMemo(() => {
    if (shouldProgressiveLayout) {
      // Immediately bypass synchronous layout for large projects
      return { nodes: [], edges: [] };
    }
    perf.mark("layout");
    const progressive = shouldProgressiveLayout;
    const laidOut = applyDagreLayout(flowNodes, flowEdges, layoutDirection, {
      progressive,
      layoutDensity,
    });
    perf.measure("layout", "layout_ms", {
      nodes: flowNodes.length,
      edges: flowEdges.length,
      direction: layoutDirection,
      progressive,
    });
    return laidOut;
  }, [
    flowEdges,
    flowNodes,
    layoutDirection,
    perf,
    shouldProgressiveLayout,
    layoutDensity,
  ]);

  const [nodes, setNodes, onNodesChange] = useNodesState(layoutNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(layoutEdges);

  const relayout = useCallback(() => {
    setIsCalculatingLayout(true);
    if (isTestEnv || !isWorkerSupported) {
      const next = applyDagreLayout(flowNodes, flowEdges, layoutDirection, {
        progressive: shouldProgressiveLayout,
        previousPositions: nodePositionsRef.current,
        layoutDensity,
      });
      nodePositionsRef.current = new Map(
        next.nodes.map((n) => [n.id, n.position]),
      );
      setNodes(next.nodes);
      setEdges(next.edges);
      setIsCalculatingLayout(false);
      if (onRelayoutComplete) {
        requestAnimationFrame(onRelayoutComplete);
      }
      return;
    }

    runLayoutInWorker(
      flowNodes,
      flowEdges,
      layoutDirection,
      {
        progressive: shouldProgressiveLayout,
        previousPositions: nodePositionsRef.current,
        layoutDensity,
      },
      (next) => {
        nodePositionsRef.current = new Map(
          next.nodes.map((n) => [n.id, n.position]),
        );
        setNodes(next.nodes);
        setEdges(next.edges);
        setIsCalculatingLayout(false);
        if (onRelayoutComplete) {
          requestAnimationFrame(onRelayoutComplete);
        }
      },
      (error) => {
        console.error("Layout worker error during manual relayout:", error);
        setIsCalculatingLayout(false);
      },
    );
  }, [
    flowEdges,
    flowNodes,
    layoutDirection,
    onRelayoutComplete,
    setEdges,
    setNodes,
    shouldProgressiveLayout,
    layoutDensity,
  ]);

  useEffect(() => {
    startTransition(() => {
      setNodes(layoutNodes);
      setEdges(layoutEdges);
    });
    nodePositionsRef.current = new Map(
      layoutNodes.map((n) => [n.id, n.position]),
    );
    if (!shouldProgressiveLayout || isTestEnv || !isWorkerSupported) {
      return;
    }

    const cancelLayout = runLayoutInWorker(
      flowNodes,
      flowEdges,
      layoutDirection,
      {
        progressive: shouldProgressiveLayout,
        previousPositions: nodePositionsRef.current,
        layoutDensity,
      },
      (refined) => {
        nodePositionsRef.current = new Map(
          refined.nodes.map((n) => [n.id, n.position]),
        );
        startTransition(() => {
          setNodes(refined.nodes);
          setEdges(refined.edges);
        });
        setIsCalculatingLayout(false);
      },
      (error) => {
        console.error("Layout worker error:", error);
        setIsCalculatingLayout(false);
      },
    );

    return () => {
      cancelLayout();
    };
  }, [
    flowEdges,
    flowNodes,
    layoutDirection,
    layoutEdges,
    layoutNodes,
    setEdges,
    setNodes,
    shouldProgressiveLayout,
    layoutDensity,
  ]);

  useEffect(() => {
    return () => {
      terminateLayoutWorker();
    };
  }, []);

  return {
    nodes,
    edges,
    setNodes,
    setEdges,
    onNodesChange,
    onEdgesChange,
    nodePositionsRef,
    relayout,
    isCalculatingLayout,
  };
}
