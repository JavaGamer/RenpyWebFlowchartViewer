import { startTransition, useCallback, useEffect, useMemo, useRef } from 'react';
import { useNodesState, useEdgesState } from '@xyflow/react';
import type { FlowNode, FlowEdge } from '../domain';
import type { LayoutDirection, ThemeName } from '../ui/viewerTypes';
import {
  type CanvasNode,
  type CanvasEdge,
  applyDagreLayout,
  PROGRESSIVE_LAYOUT_NODE_LIMIT,
} from '../flowchartTransforms';
import type { createPerfTracker } from '../perf';

type PerfTracker = ReturnType<typeof createPerfTracker>;

interface UseViewerLayoutParams {
  flowNodes: FlowNode[];
  flowEdges: FlowEdge[];
  layoutDirection: LayoutDirection;
  theme: ThemeName;
  perf: PerfTracker;
  onRelayoutComplete?: () => void;
}

export function useViewerLayout({
  flowNodes,
  flowEdges,
  layoutDirection,
  theme,
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
} {
  const nodePositionsRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const shouldProgressiveLayout = flowNodes.length > PROGRESSIVE_LAYOUT_NODE_LIMIT;

  const { nodes: layoutNodes, edges: layoutEdges } = useMemo(() => {
    perf.mark('layout');
    const progressive = shouldProgressiveLayout;
    const laidOut = applyDagreLayout(flowNodes, flowEdges, layoutDirection, { progressive, theme });
    perf.measure('layout', 'layout_ms', {
      nodes: flowNodes.length,
      edges: flowEdges.length,
      direction: layoutDirection,
      progressive,
    });
    return laidOut;
  }, [flowEdges, flowNodes, layoutDirection, perf, shouldProgressiveLayout, theme]);

  const [nodes, setNodes, onNodesChange] = useNodesState(layoutNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(layoutEdges);

  const relayout = useCallback(() => {
    const next = applyDagreLayout(flowNodes, flowEdges, layoutDirection, {
      progressive: false,
      previousPositions: nodePositionsRef.current,
      theme,
    });
    nodePositionsRef.current = new Map(next.nodes.map((n) => [n.id, n.position]));
    setNodes(next.nodes);
    setEdges(next.edges);
    if (onRelayoutComplete) {
      requestAnimationFrame(onRelayoutComplete);
    }
  }, [flowEdges, flowNodes, layoutDirection, onRelayoutComplete, setEdges, setNodes, theme]);

  useEffect(() => {
    startTransition(() => {
      setNodes(layoutNodes);
      setEdges(layoutEdges);
    });
    nodePositionsRef.current = new Map(layoutNodes.map((n) => [n.id, n.position]));
    if (!shouldProgressiveLayout) return;
    const refineId = window.setTimeout(() => {
      const refined = applyDagreLayout(flowNodes, flowEdges, layoutDirection, {
        progressive: false,
        previousPositions: nodePositionsRef.current,
        theme,
      });
      nodePositionsRef.current = new Map(refined.nodes.map((n) => [n.id, n.position]));
      startTransition(() => {
        setNodes(refined.nodes);
        setEdges(refined.edges);
      });
    }, 0);
    return () => window.clearTimeout(refineId);
  }, [flowEdges, flowNodes, layoutDirection, layoutEdges, layoutNodes, setEdges, setNodes, shouldProgressiveLayout, theme]);

  return { nodes, edges, setNodes, setEdges, onNodesChange, onEdgesChange, nodePositionsRef, relayout };
}
