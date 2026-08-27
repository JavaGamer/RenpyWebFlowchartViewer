import { useCallback, useEffect, useLayoutEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import { useViewerStore } from "../../application/index.ts";
import type { CanvasEdge, CanvasNode, FlowNode } from "../../domain/index.ts";
import { getNodeCenter } from "../../domain/index.ts";
import type { DialogueSearchResult } from "../../infrastructure/index.ts";
import { INSPECTOR_DIALOGUE_TRUNCATE_DEFAULT } from "../../config/viewerConfig.ts";
import type { CanvasCallbacksRegistry, CanvasMetrics } from "../canvasTypes.ts";
import type { createPerfTracker } from "../../infrastructure/index.ts";
import type { ReactFlowInstance } from "@xyflow/react";

export interface UseCanvasInteractionProps {
  visibleNodes: CanvasNode[];
  visibleNodeIds: Set<string>;
  visibleEdges: CanvasEdge[];
  flowNodes: FlowNode[];
  dialogueLineSearchEnabled: boolean;
  isLargeExportTarget: boolean;
  activeDialogueSearchResults: DialogueSearchResult[];
  resolvedActiveDialogueResultIndex: number;
  flowInstanceRef: React.MutableRefObject<
    ReactFlowInstance<CanvasNode, CanvasEdge> | null
  >;
  canvasCallbacksRef: React.MutableRefObject<CanvasCallbacksRegistry>;
  perf: ReturnType<typeof createPerfTracker>;
  onMetrics: (metrics: CanvasMetrics) => void;
}

export function useCanvasInteraction({
  visibleNodes,
  visibleNodeIds,
  visibleEdges,
  flowNodes,
  dialogueLineSearchEnabled,
  isLargeExportTarget,
  activeDialogueSearchResults,
  resolvedActiveDialogueResultIndex,
  flowInstanceRef,
  canvasCallbacksRef,
  perf,
  onMetrics,
}: UseCanvasInteractionProps) {
  const {
    focusNodeId,
    activeDialogueResultIndex,
    readingSpeedWpm,
  } = useViewerStore(
    useShallow((s) => ({
      focusNodeId: s.focusNodeId,
      activeDialogueResultIndex: s.activeDialogueResultIndex,
      readingSpeedWpm: s.readingSpeedWpm,
    })),
  );

  const {
    setSelectedNodeId,
    setSelectedNodeIds,
    clearMultiSelection,
    setSelectedDialogueLineIndex,
    setShowAllInspectorLines,
    setActiveDialogueResultIndex,
    setSelectedCallContextId,
    selectedCallContextId,
  } = useViewerStore(
    useShallow((s) => ({
      setSelectedNodeId: s.setSelectedNodeId,
      setSelectedNodeIds: s.setSelectedNodeIds,
      clearMultiSelection: s.clearMultiSelection,
      setSelectedDialogueLineIndex: s.setSelectedDialogueLineIndex,
      setShowAllInspectorLines: s.setShowAllInspectorLines,
      setActiveDialogueResultIndex: s.setActiveDialogueResultIndex,
      setSelectedCallContextId: s.setSelectedCallContextId,
      selectedCallContextId: s.selectedCallContextId,
    })),
  );

  const clearSelection = useCallback(() => {
    setSelectedNodeId("");
    clearMultiSelection();
    setSelectedDialogueLineIndex(null);
    setShowAllInspectorLines(false);
  }, [
    setSelectedNodeId,
    clearMultiSelection,
    setSelectedDialogueLineIndex,
    setShowAllInspectorLines,
  ]);

  const onSelectionChange = useCallback(
    ({ nodes }: { nodes: CanvasNode[] }) => {
      const ids = nodes.map((n) => n.id);
      setSelectedNodeIds(ids);
    },
    [setSelectedNodeIds],
  );

  const onNodeClick = useCallback((_: unknown, node: CanvasNode) => {
    setSelectedNodeId(node.id);
    setSelectedDialogueLineIndex(null);
    setShowAllInspectorLines(false);
    useViewerStore.getState().fetchNodeDetails([node.id]);
  }, [
    setSelectedNodeId,
    setSelectedDialogueLineIndex,
    setShowAllInspectorLines,
  ]);

  const onEdgeClick = useCallback((_: unknown, edge: CanvasEdge) => {
    const callCtx = edge.data?.callContext;
    const ctxId = callCtx?.callContextId ?? callCtx?.callEdgeId ?? edge.id;
    if (
      callCtx || edge.data?.kind === "call" || edge.data?.kind === "call_return"
    ) {
      if (selectedCallContextId === ctxId) {
        setSelectedCallContextId(null);
      } else {
        setSelectedCallContextId(ctxId);
      }
    }
  }, [selectedCallContextId, setSelectedCallContextId]);

  const onPaneClick = useCallback(() => {
    clearSelection();
    setSelectedCallContextId(null);
  }, [clearSelection, setSelectedCallContextId]);

  const onFocusSelectedNode = useCallback(() => {
    if (!focusNodeId || !flowInstanceRef.current) return;
    const target = visibleNodes.find((n) => n.id === focusNodeId && !n.hidden);
    if (!target) return;
    const center = getNodeCenter(target);
    flowInstanceRef.current.setCenter(center.x, center.y, {
      zoom: 1.1,
      duration: 250,
    });
  }, [flowInstanceRef, focusNodeId, visibleNodes]);

  const focusVisibleNode = useCallback((nodeId: string) => {
    const target = visibleNodes.find((n) => n.id === nodeId && !n.hidden);
    if (!target || !flowInstanceRef.current) return;
    const center = getNodeCenter(target);
    flowInstanceRef.current.setCenter(center.x, center.y, {
      zoom: 1.1,
      duration: 250,
    });
  }, [flowInstanceRef, visibleNodes]);

  const onSelectDialogueSearchResult = useCallback(
    (result: DialogueSearchResult) => {
      const selectedLineOutsidePreview =
        result.lineIndex > INSPECTOR_DIALOGUE_TRUNCATE_DEFAULT;
      setSelectedNodeId(result.nodeId);
      setSelectedDialogueLineIndex(result.lineIndex);
      setShowAllInspectorLines(selectedLineOutsidePreview);
      useViewerStore.getState().fetchNodeDetails([result.nodeId]);
      focusVisibleNode(result.nodeId);
    },
    [
      focusVisibleNode,
      setSelectedNodeId,
      setSelectedDialogueLineIndex,
      setShowAllInspectorLines,
    ],
  );

  const onSearchInputKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (activeDialogueSearchResults.length === 0) return;
      if (event.key === "ArrowDown") {
        event.preventDefault();
        const base = activeDialogueResultIndex < 0
          ? 0
          : activeDialogueResultIndex;
        setActiveDialogueResultIndex(
          (base + 1 + activeDialogueSearchResults.length) %
            activeDialogueSearchResults.length,
        );
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        const base = activeDialogueResultIndex < 0
          ? 0
          : activeDialogueResultIndex;
        setActiveDialogueResultIndex(
          (base - 1 + activeDialogueSearchResults.length) %
            activeDialogueSearchResults.length,
        );
        return;
      }
      if (event.key === "Enter") {
        if (resolvedActiveDialogueResultIndex < 0) return;
        event.preventDefault();
        const selected =
          activeDialogueSearchResults[resolvedActiveDialogueResultIndex];
        if (!selected) return;
        setActiveDialogueResultIndex(resolvedActiveDialogueResultIndex);
        onSelectDialogueSearchResult(selected);
      }
    },
    [
      activeDialogueResultIndex,
      activeDialogueSearchResults,
      onSelectDialogueSearchResult,
      resolvedActiveDialogueResultIndex,
      setActiveDialogueResultIndex,
    ],
  );

  // Keep registry ref updated
  useLayoutEffect(() => {
    canvasCallbacksRef.current.onSearchInputKeyDown = onSearchInputKeyDown;
  }, [canvasCallbacksRef, onSearchInputKeyDown]);

  // Report metrics to outer toolbar
  useEffect(() => {
    let totalWordCount = 0;
    let totalPauseDuration = 0;
    for (const node of flowNodes) {
      totalWordCount += node.wordCount ?? 0;
      totalPauseDuration += node.pauseDuration ?? 0;
    }

    let visibleWordCount = 0;
    let visiblePauseDuration = 0;
    for (const node of visibleNodes) {
      if (node.hidden) continue;
      visibleWordCount += node.data.wordCount ?? 0;
      visiblePauseDuration += node.data.pauseDuration ?? 0;
    }

    onMetrics({
      visibleNodeCount: visibleNodeIds.size,
      visibleEdgeCount: visibleEdges.length,
      dialogueLineSearchEnabled,
      isLargeExportTarget,
      totalWordCount,
      totalPauseDuration,
      visibleWordCount,
      visiblePauseDuration,
    });
  }, [
    dialogueLineSearchEnabled,
    flowNodes,
    isLargeExportTarget,
    onMetrics,
    readingSpeedWpm,
    visibleEdges.length,
    visibleNodeIds.size,
    visibleNodes,
  ]);

  // Performance tracking
  useEffect(() => {
    if (!perf.enabled) return;
    const startedAt = performance.now();
    const id = requestAnimationFrame(() => {
      perf.log("render_commit_ms", performance.now() - startedAt, {
        visibleNodes: visibleNodeIds.size,
        visibleEdges: visibleEdges.length,
      });
    });
    return () => cancelAnimationFrame(id);
  }, [perf, visibleEdges.length, visibleNodeIds.size]);

  return {
    onNodeClick,
    onEdgeClick,
    onPaneClick,
    onFocusSelectedNode,
    onSelectDialogueSearchResult,
    onSelectionChange,
  };
}
