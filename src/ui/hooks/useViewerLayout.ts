import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { type NodeChange, useEdgesState, useNodesState } from "@xyflow/react";
import {
  type CanvasEdge,
  type CanvasNode,
  type FlowEdge,
  type FlowNode,
  type GraphSimplificationOptions,
  type LayoutDensity,
  type LayoutDirection,
  PROGRESSIVE_LAYOUT_NODE_LIMIT,
  simplifyGraph,
} from "../../domain/index.ts";
import type { createPerfTracker } from "../../infrastructure/index.ts";
import {
  applyDagreLayout,
  areWorkersSupported,
  runLayoutInWorker,
} from "../../infrastructure/index.ts";

const globalRecord = globalThis as Record<string, unknown>;
const isTestEnv = typeof globalRecord["process"] !== "undefined" &&
  (globalRecord["process"] as { env?: { NODE_ENV?: string } } | undefined)?.env
      ?.NODE_ENV === "test";

type PerfTracker = ReturnType<typeof createPerfTracker>;

interface UseViewerLayoutParams {
  flowNodes: FlowNode[];
  flowEdges: FlowEdge[];
  layoutDirection: LayoutDirection;
  layoutDensity: LayoutDensity;
  simplifyOptions: GraphSimplificationOptions;
  perf: PerfTracker;
  onRelayoutComplete?: () => void;
}

export function useViewerLayout({
  flowNodes,
  flowEdges,
  layoutDirection,
  layoutDensity,
  simplifyOptions,
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
  const isWorkerEnabled = !isTestEnv && areWorkersSupported();
  const shouldProgressiveLayout =
    flowNodes.length > PROGRESSIVE_LAYOUT_NODE_LIMIT;
  const [isCalculatingLayout, setIsCalculatingLayout] = useState(
    isWorkerEnabled,
  );

  const { nodes: layoutNodes, edges: layoutEdges } = useMemo(() => {
    if (isWorkerEnabled) {
      // Immediately bypass synchronous layout for worker execution
      return { nodes: [], edges: [] };
    }
    perf.mark("layout");
    const progressive = shouldProgressiveLayout;
    const simplified = simplifyGraph(flowNodes, flowEdges, simplifyOptions);
    const laidOut = applyDagreLayout(
      simplified.nodes,
      simplified.edges,
      layoutDirection,
      {
        progressive,
        layoutDensity,
      },
    );
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
    isWorkerEnabled,
    simplifyOptions,
  ]);

  const [nodes, setNodes, onNodesChange] = useNodesState(layoutNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(layoutEdges);

  // Intercept and wrap onNodesChange to record manual dragging coordinates
  const onNodesChangeWrapped = useCallback(
    (changes: NodeChange<CanvasNode>[]) => {
      onNodesChange(changes);
      for (const change of changes) {
        if (change.type === "position" && change.position && change.id) {
          nodePositionsRef.current.set(change.id, change.position);
        }
      }
    },
    [onNodesChange],
  );

  const relayout = useCallback(() => {
    setIsCalculatingLayout(true);
    if (!isWorkerEnabled) {
      const simplified = simplifyGraph(flowNodes, flowEdges, simplifyOptions);
      const next = applyDagreLayout(
        simplified.nodes,
        simplified.edges,
        layoutDirection,
        {
          progressive: shouldProgressiveLayout,
          previousPositions: nodePositionsRef.current,
          layoutDensity,
        },
      );
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
        simplifyOptions,
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
    isWorkerEnabled,
    simplifyOptions,
  ]);

  useEffect(() => {
    startTransition(() => {
      setNodes(layoutNodes);
      setEdges(layoutEdges);
    });
    if (layoutNodes.length > 0) {
      nodePositionsRef.current = new Map(
        layoutNodes.map((n) => [n.id, n.position]),
      );
    }
    if (!isWorkerEnabled) {
      return;
    }

    const timer = setTimeout(() => {
      setIsCalculatingLayout(true);
    }, 0);

    const cancelLayout = runLayoutInWorker(
      flowNodes,
      flowEdges,
      layoutDirection,
      {
        progressive: shouldProgressiveLayout,
        previousPositions: nodePositionsRef.current,
        layoutDensity,
        simplifyOptions,
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
      clearTimeout(timer);
      cancelLayout();
      setIsCalculatingLayout(false);
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
    isWorkerEnabled,
    simplifyOptions,
  ]);

  return {
    nodes,
    edges,
    setNodes,
    setEdges,
    onNodesChange: onNodesChangeWrapped,
    onEdgesChange,
    nodePositionsRef,
    relayout,
    isCalculatingLayout,
  };
}
