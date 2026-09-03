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
import { useViewerStore } from "../../application/index.ts";
import { useShallow } from "zustand/react/shallow";

const globalProcess = (globalThis as unknown as {
  process?: { env?: Record<string, string | undefined> };
}).process;

const isTestEnv = Boolean(
  (globalProcess?.env?.NODE_ENV === "test" ||
    globalProcess?.env?.VITEST === "true") ||
    typeof (globalThis as unknown as { __vitest_worker__?: unknown })
        .__vitest_worker__ !== "undefined" ||
    typeof (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean })
        .IS_REACT_ACT_ENVIRONMENT !== "undefined",
);

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

function createNodePositionsMap(
  nodes: CanvasNode[],
): Map<string, { x: number; y: number }> {
  const map = new Map<string, { x: number; y: number }>();
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i]!;
    map.set(n.id, n.position);
  }
  return map;
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
  const { enableCompoundContainers, collapsedChapters } = useViewerStore(
    useShallow((s) => ({
      enableCompoundContainers: s.enableCompoundContainers,
      collapsedChapters: s.collapsedChapters,
    })),
  );

  const isInitialMountRef = useRef(true);
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
        enableCompoundContainers,
        collapsedChapters,
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
    enableCompoundContainers,
    collapsedChapters,
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

  const relayoutRafRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    return () => {
      if (relayoutRafRef.current !== undefined) {
        cancelAnimationFrame(relayoutRafRef.current);
      }
    };
  }, []);

  const relayout = useCallback(() => {
    setIsCalculatingLayout(true);
    if (!isWorkerEnabled) {
      const simplified = simplifyGraph(
        flowNodes,
        flowEdges,
        simplifyOptions,
      );
      const next = applyDagreLayout(
        simplified.nodes,
        simplified.edges,
        layoutDirection,
        {
          progressive: shouldProgressiveLayout,
          previousPositions: nodePositionsRef.current,
          layoutDensity,
          enableCompoundContainers,
          collapsedChapters,
        },
      );
      nodePositionsRef.current = createNodePositionsMap(next.nodes);
      setNodes(next.nodes);
      setEdges(next.edges);
      setIsCalculatingLayout(false);
      if (onRelayoutComplete) {
        relayoutRafRef.current = requestAnimationFrame(onRelayoutComplete);
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
        enableCompoundContainers,
        collapsedChapters,
      },
      (next) => {
        nodePositionsRef.current = createNodePositionsMap(next.nodes);
        setNodes(next.nodes);
        setEdges(next.edges);
        setIsCalculatingLayout(false);
        if (onRelayoutComplete) {
          relayoutRafRef.current = requestAnimationFrame(onRelayoutComplete);
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
    enableCompoundContainers,
    collapsedChapters,
  ]);

  useEffect(() => {
    if (isInitialMountRef.current) {
      isInitialMountRef.current = false;
      if (layoutNodes.length > 0) {
        nodePositionsRef.current = createNodePositionsMap(layoutNodes);
      }
      if (!isWorkerEnabled) {
        return;
      }
    } else {
      if (!isWorkerEnabled || flowNodes.length === 0) {
        startTransition(() => {
          setNodes(layoutNodes);
          setEdges(layoutEdges);
        });
      }
      if (layoutNodes.length > 0) {
        nodePositionsRef.current = createNodePositionsMap(layoutNodes);
      }
      if (!isWorkerEnabled) {
        return;
      }
    }

    let rafId: number | undefined;

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
        enableCompoundContainers,
        collapsedChapters,
      },
      (refined) => {
        nodePositionsRef.current = createNodePositionsMap(refined.nodes);
        startTransition(() => {
          setNodes(refined.nodes);
          setEdges(refined.edges);
        });
        setIsCalculatingLayout(false);
        if (onRelayoutComplete) {
          rafId = requestAnimationFrame(onRelayoutComplete);
        }
      },
      (error) => {
        console.error("Layout worker error:", error);
        try {
          const simplified = simplifyGraph(
            flowNodes,
            flowEdges,
            simplifyOptions,
          );
          const fallback = applyDagreLayout(
            simplified.nodes,
            simplified.edges,
            layoutDirection,
            {
              progressive: shouldProgressiveLayout,
              layoutDensity,
              enableCompoundContainers,
              collapsedChapters,
            },
          );
          startTransition(() => {
            setNodes(fallback.nodes);
            setEdges(fallback.edges);
          });
        } catch {
          // Ignore secondary fallback error
        }
        setIsCalculatingLayout(false);
      },
    );

    return () => {
      clearTimeout(timer);
      if (rafId !== undefined) {
        cancelAnimationFrame(rafId);
      }
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
    enableCompoundContainers,
    collapsedChapters,
    onRelayoutComplete,
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
