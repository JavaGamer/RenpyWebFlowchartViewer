import React, { useEffect, useMemo, useRef } from "react";
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useShallow } from "zustand/react/shallow";
import {
  type CanvasEdge,
  type CanvasNode,
  type FlowEdge,
  type FlowNode,
  getNodeCenter,
  type NodeData,
} from "../domain/index.ts";
import {
  type DialogueSearchMode,
  type ParseService,
  useViewerStore,
} from "../application/index.ts";

import type { createPerfTracker } from "../infrastructure/index.ts";
import { THEMES } from "./viewerTheme.ts";
import { edgeTypes, nodeTypes } from "./viewerReactFlowRegistry.ts";
import { useViewerLayout } from "./hooks/useViewerLayout.ts";
import { AdvancedControlsModal } from "./components/AdvancedControlsModal.tsx";
import { CanvasOverlay } from "./components/CanvasOverlay.tsx";
import { ActiveRouteBanner } from "./components/ActiveRouteBanner.tsx";
import { NarrativeAnalyticsModal } from "./components/NarrativeAnalyticsModal.tsx";
import { cn } from "./utils/cn.ts";
import { ViewerInspector } from "./viewerInspector.tsx";
import type { CanvasCallbacksRegistry, CanvasMetrics } from "./canvasTypes.ts";
import { useGraphVisibility } from "./hooks/useGraphVisibility.ts";
import { useCanvasInteraction } from "./hooks/useCanvasInteraction.ts";
import { useViewportBounds } from "./hooks/useViewportBounds.ts";

export interface FlowchartCanvasProps {
  flowNodes: FlowNode[];
  flowEdges: FlowEdge[];
  flowRef: React.RefObject<HTMLDivElement | null>;
  flowInstanceRef: React.MutableRefObject<
    ReactFlowInstance<CanvasNode, CanvasEdge> | null
  >;
  searchInputRef: React.RefObject<HTMLInputElement | null>;
  canvasCallbacksRef: React.MutableRefObject<CanvasCallbacksRegistry>;
  parseService: ParseService;
  dialogueSearchMode: DialogueSearchMode;
  onDialogueSearchModeChange?: (mode: DialogueSearchMode) => void;
  perf: ReturnType<typeof createPerfTracker>;
  onMetrics: (metrics: CanvasMetrics) => void;
}

export function FlowchartCanvas({
  flowNodes,
  flowEdges,
  flowRef,
  flowInstanceRef,
  canvasCallbacksRef,
  parseService,
  dialogueSearchMode,
  perf,
  onMetrics,
}: FlowchartCanvasProps) {
  // -- Store subscription -----------------------------------------------------
  const {
    layoutDirection,
    layoutDensity,
    theme,
    selectedNodeId,
    selectedDialogueLineIndex,
    showAllInspectorLines,
    simplifyCollapseLinearChains,
    simplifyInlineUtilities,
    simplifyInlineDetours,
    simplifyInlineStateToggles,
    simplifyInlineEmptyLabels,
    simplifyInlineDialogueThreshold,
    minimapPannable,
    minimapZoomable,
    showMediaCuesInDialogue,
  } = useViewerStore(
    useShallow((s) => ({
      layoutDirection: s.layoutDirection,
      layoutDensity: s.layoutDensity,
      theme: s.theme,
      selectedNodeId: s.selectedNodeId,
      selectedDialogueLineIndex: s.selectedDialogueLineIndex,
      showAllInspectorLines: s.showAllInspectorLines,
      simplifyCollapseLinearChains: s.simplifyCollapseLinearChains,
      simplifyInlineUtilities: s.simplifyInlineUtilities,
      simplifyInlineDetours: s.simplifyInlineDetours,
      simplifyInlineStateToggles: s.simplifyInlineStateToggles,
      simplifyInlineEmptyLabels: s.simplifyInlineEmptyLabels,
      simplifyInlineDialogueThreshold: s.simplifyInlineDialogueThreshold,
      minimapPannable: s.minimapPannable,
      minimapZoomable: s.minimapZoomable,
      showMediaCuesInDialogue: s.showMediaCuesInDialogue,
    })),
  );

  const {
    setActiveDialogueResultIndex,
    setShowMediaCuesInDialogue,
    toggleShowAllInspectorLines,
  } = useViewerStore(
    useShallow((s) => ({
      setActiveDialogueResultIndex: s.setActiveDialogueResultIndex,
      setShowMediaCuesInDialogue: s.setShowMediaCuesInDialogue,
      toggleShowAllInspectorLines: s.toggleShowAllInspectorLines,
    })),
  );

  // -- Identity-preserving refs for visible node/edge caches -----------------
  const previousVisibleNodesByIdRef = useRef<Map<string, CanvasNode>>(
    new Map(),
  );
  const previousVisibleEdgesByIdRef = useRef<Map<string, CanvasEdge>>(
    new Map(),
  );

  // -- Simplify Options ------------------------------------------------------
  const simplifyOptions = useMemo(() => ({
    collapseLinearChains: simplifyCollapseLinearChains,
    inlineUtilities: simplifyInlineUtilities,
    inlineDetours: simplifyInlineDetours,
    inlineStateToggles: simplifyInlineStateToggles,
    inlineEmptyLabels: simplifyInlineEmptyLabels,
    inlineDialogueThreshold: simplifyInlineDialogueThreshold,
  }), [
    simplifyCollapseLinearChains,
    simplifyInlineUtilities,
    simplifyInlineDetours,
    simplifyInlineStateToggles,
    simplifyInlineEmptyLabels,
    simplifyInlineDialogueThreshold,
  ]);

  // -- Layout hook ------------------------------------------------------------
  const onRelayoutComplete = React.useCallback(() => {
    flowInstanceRef.current?.fitView({ padding: 0.2 });
  }, [flowInstanceRef]);

  const {
    nodes,
    edges,
    onNodesChange,
    onEdgesChange,
    relayout,
    isCalculatingLayout,
  } = useViewerLayout({
    flowNodes,
    flowEdges,
    layoutDirection,
    layoutDensity,
    simplifyOptions,
    perf,
    onRelayoutComplete,
  });

  const { bounds: viewportBounds, updateBounds } = useViewportBounds(
    flowRef,
    flowInstanceRef,
    400,
  );

  // -- Visibility Hook --------------------------------------------------------
  const {
    chapters,
    labels,
    visibleSubgraphLabels,
    collapsedLabelCount,
    shouldShowAllLabelSubgraphToggles,
    visibleLabelSubgraphToggles,
    largeGraphModeStatusText,
    setAllVisibleSubgraphLabelsCollapsed,
    conditionalVisibility,
    effectiveSearch,
    activeDialogueSearchResults,
    logicalVisibleNodes,
    visibleNodes,
    visibleNodeIds,
    visibleEdges,
    selectedNode,
    nodeSearchMatchCount,
    resolvedActiveDialogueResultIndex,
    isLargeExportTarget,
    focusTargetNode,
    chapterStats,
    dialogueLineSearchEnabled,
    largeGraphMode,
  } = useGraphVisibility({
    nodes,
    edges,
    flowNodes,
    flowEdges,
    dialogueSearchMode,
    parseService,
    previousVisibleNodesByIdRef,
    previousVisibleEdgesByIdRef,
    viewportBounds,
  });

  // -- Interaction Hook -------------------------------------------------------
  const {
    onNodeClick,
    onEdgeClick,
    onPaneClick,
    onFocusSelectedNode,
    onSelectDialogueSearchResult,
  } = useCanvasInteraction({
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
  });

  // Issue 10: update ref caches without triggering re-renders
  useEffect(() => {
    const current = previousVisibleNodesByIdRef.current;
    if (
      current.size === logicalVisibleNodes.length &&
      logicalVisibleNodes.every((node: CanvasNode) =>
        current.get(node.id) === node
      )
    ) {
      return;
    }
    previousVisibleNodesByIdRef.current = new Map(
      logicalVisibleNodes.map((node: CanvasNode) => [node.id, node]),
    );
  }, [logicalVisibleNodes]);

  useEffect(() => {
    const current = previousVisibleEdgesByIdRef.current;
    if (
      current.size === visibleEdges.length &&
      visibleEdges.every((edge: CanvasEdge) => current.get(edge.id) === edge)
    ) {
      return;
    }
    previousVisibleEdgesByIdRef.current = new Map(
      visibleEdges.map((edge: CanvasEdge) => [edge.id, edge]),
    );
  }, [visibleEdges]);

  // -- Advanced controls auto-open -------------------------------------------
  useEffect(() => {
    if (chapters.length > 0) {
      // Auto-open advanced controls panel when chapters exist
      // can be customized via store if desired.
    }
  }, [chapters]);

  const selectedNodeData = selectedNode?.data as NodeData | undefined;

  const onFocusNode = React.useCallback((nodeId: string) => {
    const target = visibleNodes.find((n) => n.id === nodeId);
    if (target) {
      const { x, y } = getNodeCenter(target);
      flowInstanceRef.current?.setCenter(x, y, { zoom: 1, duration: 400 });
    }
  }, [visibleNodes, flowInstanceRef]);

  return (
    <>
      <AdvancedControlsModal
        relayout={relayout}
        focusTargetNode={focusTargetNode}
        onFocusSelectedNode={onFocusSelectedNode}
        largeGraphMode={largeGraphMode}
        largeGraphModeStatusText={largeGraphModeStatusText}
        labels={labels}
        chapters={chapters}
        collapsedLabelCount={collapsedLabelCount}
        visibleSubgraphLabels={visibleSubgraphLabels}
        visibleLabelSubgraphToggles={visibleLabelSubgraphToggles}
        shouldShowAllLabelSubgraphToggles={shouldShowAllLabelSubgraphToggles}
        setAllVisibleSubgraphLabelsCollapsed={setAllVisibleSubgraphLabelsCollapsed}
        discoveredFlags={conditionalVisibility.discoveredFlags}
        chapterStats={chapterStats}
      />

      <NarrativeAnalyticsModal onFocusNode={onFocusNode} />

      <div className="flex-1 flex flex-col xl:flex-row min-h-0">
        <div
          ref={flowRef}
          className="flex-1 min-h-[320px] relative"
          style={{ backgroundColor: THEMES[theme].pageBg }}
          data-theme={theme}
        >
          <CanvasOverlay isCalculatingLayout={isCalculatingLayout} />
          <ActiveRouteBanner onFocusNode={onFocusNode} />
          <ReactFlow
            colorMode={theme === "dark" ? "dark" : "light"}
            nodes={visibleNodes}
            edges={visibleEdges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeClick={onNodeClick}
            onEdgeClick={onEdgeClick}
            onPaneClick={onPaneClick}
            onMove={updateBounds}
            onInit={(instance) => {
              flowInstanceRef.current = instance as ReactFlowInstance<
                CanvasNode,
                CanvasEdge
              >;
              updateBounds();
            }}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            minZoom={0.1}
            maxZoom={2.5}
            nodesDraggable
            proOptions={{ hideAttribution: false }}
          >
            <Background color={THEMES[theme].grid} gap={20} />
            <Controls />
            <MiniMap
              className={cn(
                minimapPannable && "minimap-pannable",
                minimapZoomable && "minimap-zoomable",
              )}
              pannable={minimapPannable}
              zoomable={minimapZoomable}
              nodeColor={(n) =>
                n.type === "labelNode"
                  ? THEMES[theme].minimapLabel
                  : n.type === "menuNode"
                  ? THEMES[theme].minimapMenu
                  : THEMES[theme].minimapDecision}
            />
          </ReactFlow>
        </div>
        <ViewerInspector
          effectiveSearch={effectiveSearch}
          nodeSearchMatchCount={nodeSearchMatchCount}
          dialogueLineSearchEnabled={dialogueLineSearchEnabled}
          activeDialogueSearchResults={activeDialogueSearchResults}
          resolvedActiveDialogueResultIndex={resolvedActiveDialogueResultIndex}
          selectedNode={selectedNode}
          selectedNodeData={selectedNodeData}
          selectedNodeId={selectedNodeId}
          selectedDialogueLineIndex={selectedDialogueLineIndex}
          showAllInspectorLines={showAllInspectorLines}
          showMediaCuesInDialogue={showMediaCuesInDialogue}
          setShowMediaCuesInDialogue={setShowMediaCuesInDialogue}
          onToggleShowAllInspectorLines={toggleShowAllInspectorLines}
          onSetActiveDialogueResultIndex={setActiveDialogueResultIndex}
          onSelectDialogueSearchResult={onSelectDialogueSearchResult}
          flowEdges={flowEdges}
        />
      </div>
    </>
  );
}
