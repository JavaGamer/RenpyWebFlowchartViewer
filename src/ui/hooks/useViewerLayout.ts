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
  type AABB,
  applyDagreLayout,
  areWorkersSupported,
  computeSpatialItemsAndBounds,
  runLayoutInWorker,
  type SpatialItem,
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
  const nodeById = new Map<string, CanvasNode>();
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i]!;
    nodeById.set(n.id, n);
  }
  const map = new Map<string, { x: number; y: number }>();
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i]!;
    if (n.parentId) {
      const parent = nodeById.get(n.parentId);
      if (parent) {
        map.set(n.id, {
          x: parent.position.x + n.position.x,
          y: parent.position.y + n.position.y,
        });
        continue;
      }
    }
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
  spatialItems?: SpatialItem[];
  spatialBounds?: AABB;
  setNodes: ReturnType<typeof useNodesState<CanvasNode>>[1];
  setEdges: ReturnType<typeof useEdgesState<CanvasEdge>>[1];
  onNodesChange: ReturnType<typeof useNodesState<CanvasNode>>[2];
  onEdgesChange: ReturnType<typeof useEdgesState<CanvasEdge>>[2];
  nodePositionsRef: React.RefObject<Map<string, { x: number; y: number }>>;
  relayout: () => void;
  isCalculatingLayout: boolean;
} {
  const {
    enableCompoundContainers,
    collapsedChapters,
    collapsedParentLabels,
  } = useViewerStore(
    useShallow((s) => ({
      enableCompoundContainers: s.enableCompoundContainers,
      collapsedChapters: s.collapsedChapters,
      collapsedParentLabels: s.collapsedParentLabels,
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

  const {
    nodes: layoutNodes,
    edges: layoutEdges,
    spatialItems: layoutSpatialItems,
    spatialBounds: layoutSpatialBounds,
  } = useMemo(() => {
    if (isWorkerEnabled) {
      // Immediately bypass synchronous layout for worker execution
      return {
        nodes: [],
        edges: [],
        spatialItems: undefined,
        spatialBounds: undefined,
      };
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
        collapsedParentLabels,
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
    collapsedParentLabels,
  ]);

  const [nodes, setNodes, onNodesChange] = useNodesState(layoutNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(layoutEdges);
  const [workerSpatialData, setWorkerSpatialData] = useState<{
    spatialItems?: SpatialItem[];
    spatialBounds?: AABB;
  }>({});
  const [draggedSpatialData, setDraggedSpatialData] = useState<
    {
      forLayoutNodes: CanvasNode[];
      spatialItems?: SpatialItem[];
      spatialBounds?: AABB;
    } | null
  >(null);

  const nodesRef = useRef(nodes);
  const layoutNodesRef = useRef(layoutNodes);
  useEffect(() => {
    nodesRef.current = nodes;
    layoutNodesRef.current = layoutNodes;
  }, [nodes, layoutNodes]);

  // Intercept and wrap onNodesChange to record manual dragging coordinates
  const onNodesChangeWrapped = useCallback(
    (changes: NodeChange<CanvasNode>[]) => {
      onNodesChange(changes);
      let dragEnded = false;
      for (const change of changes) {
        if (change.type === "position") {
          if (change.position && change.id) {
            nodePositionsRef.current.set(change.id, change.position);
          }
          if (change.dragging === false) {
            dragEnded = true;
          }
        }
      }
      if (dragEnded && nodesRef.current.length >= 150) {
        const updatedNodes = nodesRef.current.map((n) => {
          const pos = nodePositionsRef.current.get(n.id);
          return pos && !n.parentId ? { ...n, position: pos } : n;
        });
        const { items, bounds } = computeSpatialItemsAndBounds(updatedNodes);
        setDraggedSpatialData({
          forLayoutNodes: layoutNodesRef.current,
          spatialItems: items,
          spatialBounds: bounds,
        });
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
    setDraggedSpatialData(null);
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
          collapsedParentLabels,
        },
      );
      nodePositionsRef.current = createNodePositionsMap(next.nodes);
      setNodes(next.nodes);
      setEdges(next.edges);
      setWorkerSpatialData({
        spatialItems: next.spatialItems,
        spatialBounds: next.spatialBounds,
      });
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
        collapsedParentLabels,
      },
      (next) => {
        nodePositionsRef.current = createNodePositionsMap(next.nodes);
        setDraggedSpatialData(null);
        setNodes(next.nodes);
        setEdges(next.edges);
        setWorkerSpatialData({
          spatialItems: next.spatialItems,
          spatialBounds: next.spatialBounds,
        });
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
    collapsedParentLabels,
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
        collapsedParentLabels,
      },
      (refined) => {
        nodePositionsRef.current = createNodePositionsMap(refined.nodes);
        startTransition(() => {
          setDraggedSpatialData(null);
          setNodes(refined.nodes);
          setEdges(refined.edges);
          setWorkerSpatialData({
            spatialItems: refined.spatialItems,
            spatialBounds: refined.spatialBounds,
          });
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
              collapsedParentLabels,
            },
          );
          startTransition(() => {
            setDraggedSpatialData(null);
            setNodes(fallback.nodes);
            setEdges(fallback.edges);
            setWorkerSpatialData({
              spatialItems: fallback.spatialItems,
              spatialBounds: fallback.spatialBounds,
            });
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
    collapsedParentLabels,
    onRelayoutComplete,
  ]);

  const validDraggedSpatial =
    draggedSpatialData && draggedSpatialData.forLayoutNodes === layoutNodes
      ? draggedSpatialData
      : null;

  const activeSpatialItems = validDraggedSpatial
    ? validDraggedSpatial.spatialItems
    : (isWorkerEnabled ? workerSpatialData.spatialItems : layoutSpatialItems);
  const activeSpatialBounds = validDraggedSpatial
    ? validDraggedSpatial.spatialBounds
    : (isWorkerEnabled ? workerSpatialData.spatialBounds : layoutSpatialBounds);

  return {
    nodes,
    edges,
    spatialItems: activeSpatialItems,
    spatialBounds: activeSpatialBounds,
    setNodes,
    setEdges,
    onNodesChange: onNodesChangeWrapped,
    onEdgesChange,
    nodePositionsRef,
    relayout,
    isCalculatingLayout,
  };
}
