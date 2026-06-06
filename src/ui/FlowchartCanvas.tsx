import React, { useCallback, useEffect, useLayoutEffect, useMemo } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type ReactFlowInstance,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useShallow } from 'zustand/react/shallow';
import {
  type FlowNode,
  type FlowEdge,
  type CanvasNode,
  type CanvasEdge,
  buildConditionalVisibility,
  buildVisibleEdges,
  buildVisibleNodes,
  getNodeCenter,
} from '../domain';
import {
  type DialogueSearchMode,
  type ParseService,
  useViewerStore,
} from '../application';
import {
  LARGE_EXPORT_GRAPH_ELEMENTS_THRESHOLD,
  INSPECTOR_DIALOGUE_TRUNCATE_DEFAULT,
  LARGE_GRAPH_EDGE_THRESHOLD,
  LARGE_GRAPH_NODE_THRESHOLD,
} from '../config/viewerConfig';

import type { createPerfTracker } from '../infrastructure';
import { THEMES } from './viewerTheme';
import { nodeTypes, edgeTypes } from './viewerReactFlowRegistry';
import type { DialogueSearchResult } from '../infrastructure';
import { useViewerLayout } from './hooks/useViewerLayout';
import { useViewerSearch } from './hooks/useViewerSearch';
import { ViewerAdvancedControls } from './ViewerAdvancedControls';
import { ViewerInspector } from './viewerInspector';
import { MAX_VISIBLE_LABEL_SUBGRAPH_TOGGLES } from './viewerConstants';
import type { CanvasMetrics, CanvasCallbacksRegistry } from './canvasTypes';
import { deriveCollapsedLabelChildren } from './canvasHelpers';

export interface FlowchartCanvasProps {
  flowNodes: FlowNode[];
  flowEdges: FlowEdge[];
  flowRef: React.RefObject<HTMLDivElement | null>;
  flowInstanceRef: React.MutableRefObject<ReactFlowInstance<CanvasNode, CanvasEdge> | null>;
  searchInputRef: React.RefObject<HTMLInputElement | null>;
  previousVisibleNodesByIdRef: React.MutableRefObject<Map<string, CanvasNode>>;
  previousVisibleEdgesByIdRef: React.MutableRefObject<Map<string, CanvasEdge>>;
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
  previousVisibleNodesByIdRef,
  previousVisibleEdgesByIdRef,
  canvasCallbacksRef,
  parseService,
  dialogueSearchMode,
  onDialogueSearchModeChange,
  perf,
  onMetrics,
}: FlowchartCanvasProps) {
  // -- Viewer store -----------------------------------------------------------
  const {
    layoutDirection,
    searchInput,
    labelSubgraphSearchInput,
    minDialogue,
    theme,
    collapsedChapters,
    collapsedParentLabels,
    showCallReturns,
    showAudioAssetCues,
    visibleEdgeKinds,
    focusNodeId,
    largeGraphModeOverride,
    selectedNodeId,
    selectedDialogueLineIndex,
    showAllInspectorLines,
    activeDialogueResultIndex,
    dialogueSearchResults,
    showAdvancedControls,
    showAllLabelSubgraphToggles,
    standaloneDialogueSearchMode,
    mockFlags,
    conditionVisibilityMode,
  } = useViewerStore(useShallow((s) => ({
    layoutDirection: s.layoutDirection,
    searchInput: s.searchInput,
    labelSubgraphSearchInput: s.labelSubgraphSearchInput,
    minDialogue: s.minDialogue,
    theme: s.theme,
    collapsedChapters: s.collapsedChapters,
    collapsedParentLabels: s.collapsedParentLabels,
    showCallReturns: s.showCallReturns,
    showAudioAssetCues: s.showAudioAssetCues,
    visibleEdgeKinds: s.visibleEdgeKinds,
    focusNodeId: s.focusNodeId,
    largeGraphModeOverride: s.largeGraphModeOverride,
    selectedNodeId: s.selectedNodeId,
    selectedDialogueLineIndex: s.selectedDialogueLineIndex,
    showAllInspectorLines: s.showAllInspectorLines,
    activeDialogueResultIndex: s.activeDialogueResultIndex,
    dialogueSearchResults: s.dialogueSearchResults,
    showAdvancedControls: s.showAdvancedControls,
    showAllLabelSubgraphToggles: s.showAllLabelSubgraphToggles,
    standaloneDialogueSearchMode: s.standaloneDialogueSearchMode,
    mockFlags: s.mockFlags,
    conditionVisibilityMode: s.conditionVisibilityMode,
  })));
  const {
    setLayoutDirection,
    setLabelSubgraphSearchInput,
    setTheme,
    toggleChapter,
    toggleParentLabel,
    setAllParentLabelsCollapsed,
    setShowCallReturns,
    setShowAudioAssetCues,
    setEdgeKindVisible,
    setFocusNodeId,
    setLargeGraphModeOverride,
    setSelectedNodeId,
    setSelectedDialogueLineIndex,
    toggleShowAllInspectorLines,
    setShowAllInspectorLines,
    setActiveDialogueResultIndex,
    setDialogueSearchResults,
    toggleShowAllLabelSubgraphToggles,
    setStandaloneDialogueSearchMode,
    setMockFlag,
    resetMockFlags,
    setConditionVisibilityMode,
    resetSession,
  } = useViewerStore(useShallow((s) => ({
    setLayoutDirection: s.setLayoutDirection,
    setLabelSubgraphSearchInput: s.setLabelSubgraphSearchInput,
    setTheme: s.setTheme,
    toggleChapter: s.toggleChapter,
    toggleParentLabel: s.toggleParentLabel,
    setAllParentLabelsCollapsed: s.setAllParentLabelsCollapsed,
    setShowCallReturns: s.setShowCallReturns,
    setShowAudioAssetCues: s.setShowAudioAssetCues,
    setEdgeKindVisible: s.setEdgeKindVisible,
    setFocusNodeId: s.setFocusNodeId,
    setLargeGraphModeOverride: s.setLargeGraphModeOverride,
    setSelectedNodeId: s.setSelectedNodeId,
    setSelectedDialogueLineIndex: s.setSelectedDialogueLineIndex,
    toggleShowAllInspectorLines: s.toggleShowAllInspectorLines,
    setShowAllInspectorLines: s.setShowAllInspectorLines,
    setActiveDialogueResultIndex: s.setActiveDialogueResultIndex,
    setDialogueSearchResults: s.setDialogueSearchResults,
    toggleShowAllLabelSubgraphToggles: s.toggleShowAllLabelSubgraphToggles,
    setStandaloneDialogueSearchMode: s.setStandaloneDialogueSearchMode,
    setMockFlag: s.setMockFlag,
    resetMockFlags: s.resetMockFlags,
    setConditionVisibilityMode: s.setConditionVisibilityMode,
    resetSession: s.resetSession,
  })));

  // Reset session state when this component unmounts (e.g. on new import).
  useEffect(() => () => resetSession(), [resetSession]);

  useEffect(() => {
    setStandaloneDialogueSearchMode(dialogueSearchMode);
  }, [dialogueSearchMode, setStandaloneDialogueSearchMode]);

  const selectedDialogueSearchMode = onDialogueSearchModeChange
    ? dialogueSearchMode
    : standaloneDialogueSearchMode;

  const autoLargeGraphMode = useMemo(
    () => flowNodes.length > LARGE_GRAPH_NODE_THRESHOLD || flowEdges.length > LARGE_GRAPH_EDGE_THRESHOLD,
    [flowEdges.length, flowNodes.length],
  );
  const largeGraphMode = largeGraphModeOverride ?? autoLargeGraphMode;

  const effectiveDialogueSearchMode = useMemo<DialogueSearchMode>(
    () =>
      selectedDialogueSearchMode === 'auto'
        ? (autoLargeGraphMode ? 'countOnly' : 'full')
        : selectedDialogueSearchMode,
    [autoLargeGraphMode, selectedDialogueSearchMode],
  );
  const dialogueLineSearchEnabled = effectiveDialogueSearchMode === 'full';

  // -- Layout hook ------------------------------------------------------------
  const onRelayoutComplete = useCallback(() => {
    flowInstanceRef.current?.fitView({ padding: 0.2 });
  }, [flowInstanceRef]);

  const {
    nodes,
    edges,
    onNodesChange,
    onEdgesChange,
    relayout,
  } = useViewerLayout({
    flowNodes,
    flowEdges,
    layoutDirection,
    theme,
    perf,
    onRelayoutComplete,
  });

  // -- Derived graph metadata -------------------------------------------------
  const chapters = useMemo(
    () =>
      Array.from(
        new Set(
          flowNodes
            .map((n) => n.chapter)
            .filter((chapter): chapter is string => Boolean(chapter)),
        ),
      ).sort(),
    [flowNodes],
  );

  const labels = useMemo(
    () => flowNodes.filter((n) => n.type === 'LABEL').map((n) => n.id).sort(),
    [flowNodes],
  );

  const labelSubgraphSearch = labelSubgraphSearchInput.trim().toLowerCase();
  const visibleSubgraphLabels = useMemo(
    () =>
      labels.filter((label) =>
        labelSubgraphSearch.length === 0 ? true : label.toLowerCase().includes(labelSubgraphSearch),
      ),
    [labelSubgraphSearch, labels],
  );

  const collapsedLabelCount = useMemo(
    () => labels.filter((label) => collapsedParentLabels[label]).length,
    [collapsedParentLabels, labels],
  );

  const shouldShowAllLabelSubgraphToggles =
    showAllLabelSubgraphToggles && visibleSubgraphLabels.length > MAX_VISIBLE_LABEL_SUBGRAPH_TOGGLES;

  const visibleLabelSubgraphToggles = useMemo(
    () =>
      shouldShowAllLabelSubgraphToggles
        ? visibleSubgraphLabels
        : visibleSubgraphLabels.slice(0, MAX_VISIBLE_LABEL_SUBGRAPH_TOGGLES),
    [shouldShowAllLabelSubgraphToggles, visibleSubgraphLabels],
  );

  const largeGraphModeStatusText = useMemo(() => {
    if (autoLargeGraphMode && largeGraphModeOverride === null) {
      return 'Auto-enabled from graph size.';
    }
    if (autoLargeGraphMode && largeGraphModeOverride !== null) {
      return 'Auto-detected large graph; manual override active.';
    }
    if (!autoLargeGraphMode && largeGraphModeOverride === true) {
      return 'Manually enabled.';
    }
    return 'Off.';
  }, [autoLargeGraphMode, largeGraphModeOverride]);

  const collapsedLabelChildren = useMemo(
    () => deriveCollapsedLabelChildren(flowNodes, collapsedParentLabels),
    [collapsedParentLabels, flowNodes],
  );

  const setAllVisibleSubgraphLabelsCollapsed = useCallback(
    (collapsed: boolean) => {
      setAllParentLabelsCollapsed(visibleSubgraphLabels, collapsed);
    },
    [setAllParentLabelsCollapsed, visibleSubgraphLabels],
  );

  const conditionalVisibility = useMemo(
    () => buildConditionalVisibility({ edges, mockFlags }),
    [edges, mockFlags],
  );

  // -- Search hook ------------------------------------------------------------
  const {
    effectiveSearch,
    searchMatchNodeIds,
    dialogueMatchNodeIds,
    activeDialogueSearchResults,
    nodeSearchMatchIds,
  } = useViewerSearch({
    nodes,
    searchInput,
    largeGraphMode,
    dialogueLineSearchEnabled,
    collapsedChapters,
    collapsedLabelChildren,
    minDialogue,
    parseService,
    dialogueSearchResults,
    setDialogueSearchResults,
  });

  // -- Visible nodes/edges ----------------------------------------------------
  const visibleNodes = useMemo(
    () =>
      buildVisibleNodes({
        nodes,
        search: effectiveSearch,
        searchMatchNodeIds,
        includeDialogueLineSearch: false,
        dialogueMatchNodeIds: dialogueLineSearchEnabled ? dialogueMatchNodeIds : null,
        minDialogue,
        collapsedChapters,
        collapsedLabelChildren,
        conditionHiddenNodeIds:
          conditionVisibilityMode === 'hide' ? conditionalVisibility.hiddenNodeIds : undefined,
        theme,
        // eslint-disable-next-line react-hooks/refs -- intentional: reads ref.current inside memo to get the identity-preserving cache map; the cache is updated in a useEffect after each render so stale reads can't occur (Issue 10)
        previousById: previousVisibleNodesByIdRef.current,
      }),
    // previousVisibleNodesByIdRef is a stable ref — including it here does not cause extra
    // renders but satisfies exhaustive-deps. .current is read intentionally inside the memo
    // so the identity-preserving cache is consulted on each recompute (Issue 10).
    [
      collapsedChapters,
      collapsedLabelChildren,
      conditionVisibilityMode,
      conditionalVisibility.hiddenNodeIds,
      dialogueMatchNodeIds,
      dialogueLineSearchEnabled,
      effectiveSearch,
      minDialogue,
      nodes,
      previousVisibleNodesByIdRef,
      searchMatchNodeIds,
      theme,
    ],
  );

  const visibleNodeIds = useMemo(
    () => new Set(visibleNodes.filter((n) => !n.hidden).map((n) => n.id)),
    [visibleNodes],
  );

  const visibleEdges = useMemo(
    () =>
      buildVisibleEdges({
        edges,
        showCallReturns,
        visibleEdgeKinds,
        visibleNodeIds,
        edgeColor: THEMES[theme].edge,
        largeGraphMode,
        conditionVisibilityMode,
        edgeConditionStateById: conditionalVisibility.edgeConditionStateById,
        // eslint-disable-next-line react-hooks/refs -- intentional: same pattern as above (Issue 10)
        previousById: previousVisibleEdgesByIdRef.current,
      }),
    // previousVisibleEdgesByIdRef is a stable ref — including it here does not cause extra
    // renders but satisfies exhaustive-deps (Issue 10).
    [
      conditionalVisibility.edgeConditionStateById,
      conditionVisibilityMode,
      edges,
      largeGraphMode,
      previousVisibleEdgesByIdRef,
      showCallReturns,
      theme,
      visibleEdgeKinds,
      visibleNodeIds,
    ],
  );

  // Issue 10: update ref caches without triggering re-renders
  useEffect(() => {
    const current = previousVisibleNodesByIdRef.current;
    if (
      current.size === visibleNodes.length &&
      visibleNodes.every((node) => current.get(node.id) === node)
    ) {
      return;
    }
    previousVisibleNodesByIdRef.current = new Map(visibleNodes.map((node) => [node.id, node]));
  }, [previousVisibleNodesByIdRef, visibleNodes]);

  useEffect(() => {
    const current = previousVisibleEdgesByIdRef.current;
    if (
      current.size === visibleEdges.length &&
      visibleEdges.every((edge) => current.get(edge.id) === edge)
    ) {
      return;
    }
    previousVisibleEdgesByIdRef.current = new Map(visibleEdges.map((edge) => [edge.id, edge]));
  }, [previousVisibleEdgesByIdRef, visibleEdges]);

  const selectedNode = useMemo(
    () => visibleNodes.find((n) => n.id === selectedNodeId && !n.hidden) ?? null,
    [selectedNodeId, visibleNodes],
  );

  const selectedNodeData = selectedNode?.data as { label?: string; dialogueCount?: number; dialogueLines?: string[]; audioAssetCues?: import('../domain/graph').AudioAssetCue[] } | undefined;

  const nodeSearchMatchCount = useMemo(() => {
    if (!nodeSearchMatchIds) return 0;
    let matches = 0;
    for (const node of visibleNodes) {
      if (node.hidden) continue;
      if (nodeSearchMatchIds.has(node.id)) {
        matches += 1;
      }
    }
    return matches;
  }, [nodeSearchMatchIds, visibleNodes]);

  const resolvedActiveDialogueResultIndex = useMemo(() => {
    if (activeDialogueSearchResults.length === 0) return -1;
    if (activeDialogueResultIndex < 0) return 0;
    if (activeDialogueResultIndex >= activeDialogueSearchResults.length) return activeDialogueSearchResults.length - 1;
    return activeDialogueResultIndex;
  }, [activeDialogueResultIndex, activeDialogueSearchResults.length]);

  const isLargeExportTarget = useMemo(
    () =>
      visibleNodeIds.size + visibleEdges.length >= LARGE_EXPORT_GRAPH_ELEMENTS_THRESHOLD,
    [visibleEdges.length, visibleNodeIds.size],
  );

  const focusTargetNode = useMemo(
    () => visibleNodes.find((n) => n.id === focusNodeId && !n.hidden),
    [focusNodeId, visibleNodes],
  );

  // -- Callbacks --------------------------------------------------------------
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

  const onSelectDialogueSearchResult = useCallback((result: DialogueSearchResult) => {
    const targetNode = visibleNodes.find((node) => node.id === result.nodeId && !node.hidden);
    const targetNodeData = targetNode?.data as { dialogueLines?: string[] } | undefined;
    const totalLines = targetNodeData?.dialogueLines?.length ?? 0;
    const selectedLineOutsidePreview = result.lineIndex > INSPECTOR_DIALOGUE_TRUNCATE_DEFAULT;
    const hasTruncation = totalLines > INSPECTOR_DIALOGUE_TRUNCATE_DEFAULT;
    setSelectedNodeId(result.nodeId);
    setSelectedDialogueLineIndex(result.lineIndex);
    setShowAllInspectorLines(hasTruncation && selectedLineOutsidePreview);
    focusVisibleNode(result.nodeId);
  }, [focusVisibleNode, setSelectedNodeId, setSelectedDialogueLineIndex, setShowAllInspectorLines, visibleNodes]);

  const onSearchInputKeyDown = useCallback((event: React.KeyboardEvent<HTMLInputElement>) => {
    if (activeDialogueSearchResults.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      const base = activeDialogueResultIndex < 0 ? 0 : activeDialogueResultIndex;
      setActiveDialogueResultIndex((base + 1 + activeDialogueSearchResults.length) % activeDialogueSearchResults.length);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      const base = activeDialogueResultIndex < 0 ? 0 : activeDialogueResultIndex;
      setActiveDialogueResultIndex((base - 1 + activeDialogueSearchResults.length) % activeDialogueSearchResults.length);
      return;
    }
    if (event.key === 'Enter') {
      if (resolvedActiveDialogueResultIndex < 0) return;
      event.preventDefault();
      const selected = activeDialogueSearchResults[resolvedActiveDialogueResultIndex];
      setActiveDialogueResultIndex(resolvedActiveDialogueResultIndex);
      onSelectDialogueSearchResult(selected);
    }
  }, [activeDialogueResultIndex, activeDialogueSearchResults, onSelectDialogueSearchResult, resolvedActiveDialogueResultIndex, setActiveDialogueResultIndex]);

  // Keep the registry ref current so the outer stable wrapper always calls
  // the latest version. Runs only when the callback identity changes.
  useLayoutEffect(() => {
    canvasCallbacksRef.current.onSearchInputKeyDown = onSearchInputKeyDown;
  }, [canvasCallbacksRef, onSearchInputKeyDown]);

  // -- Report metrics to outer toolbar ----------------------------------------
  useEffect(() => {
    onMetrics({
      visibleNodeCount: visibleNodeIds.size,
      visibleEdgeCount: visibleEdges.length,
      dialogueLineSearchEnabled,
      isLargeExportTarget,
    });
  }, [dialogueLineSearchEnabled, isLargeExportTarget, onMetrics, visibleEdges.length, visibleNodeIds.size]);

  // -- Performance tracking ---------------------------------------------------
  useEffect(() => {
    if (!perf.enabled) return;
    const startedAt = performance.now();
    const id = requestAnimationFrame(() => {
      perf.log('render_commit_ms', performance.now() - startedAt, {
        visibleNodes: visibleNodeIds.size,
        visibleEdges: visibleEdges.length,
      });
    });
    return () => cancelAnimationFrame(id);
  }, [perf, visibleEdges.length, visibleNodeIds.size]);

  // -- Render -----------------------------------------------------------------
  return (
    <>
      {showAdvancedControls && (
        <div id="viewer-advanced-controls" className="px-3 sm:px-4 pb-3 bg-white border-b border-gray-200 shrink-0">
          <ViewerAdvancedControls
            layoutDirection={layoutDirection}
            setLayoutDirection={setLayoutDirection}
            onRelayout={relayout}
            theme={theme}
            setTheme={setTheme}
            focusNodeId={focusNodeId}
            setFocusNodeId={setFocusNodeId}
            labels={labels}
            onFocusSelectedNode={onFocusSelectedNode}
            focusTargetNode={focusTargetNode}
            showCallReturns={showCallReturns}
            setShowCallReturns={setShowCallReturns}
            showAudioAssetCues={showAudioAssetCues}
            setShowAudioAssetCues={setShowAudioAssetCues}
            largeGraphMode={largeGraphMode}
            largeGraphModeOverride={largeGraphModeOverride}
            setLargeGraphModeOverride={setLargeGraphModeOverride}
            largeGraphModeStatusText={largeGraphModeStatusText}
            visibleEdgeKinds={visibleEdgeKinds}
            setEdgeKindVisible={setEdgeKindVisible}
            chapters={chapters}
            collapsedChapters={collapsedChapters}
            toggleChapter={toggleChapter}
            collapsedLabelCount={collapsedLabelCount}
            labelSubgraphSearchInput={labelSubgraphSearchInput}
            setLabelSubgraphSearchInput={setLabelSubgraphSearchInput}
            visibleSubgraphLabels={visibleSubgraphLabels}
            visibleLabelSubgraphToggles={visibleLabelSubgraphToggles}
            shouldShowAllLabelSubgraphToggles={shouldShowAllLabelSubgraphToggles}
            collapsedParentLabels={collapsedParentLabels}
            toggleParentLabel={toggleParentLabel}
            setAllVisibleSubgraphLabelsCollapsed={setAllVisibleSubgraphLabelsCollapsed}
            toggleShowAllLabelSubgraphToggles={toggleShowAllLabelSubgraphToggles}
            discoveredFlags={conditionalVisibility.discoveredFlags}
            mockFlags={mockFlags}
            setMockFlag={setMockFlag}
            resetMockFlags={resetMockFlags}
            conditionVisibilityMode={conditionVisibilityMode}
            setConditionVisibilityMode={setConditionVisibilityMode}
          />
        </div>
      )}

      <div className="flex-1 flex flex-col xl:flex-row min-h-0">
        <div ref={flowRef} className="flex-1 min-h-[320px]" style={{ backgroundColor: THEMES[theme].pageBg }}>
          <ReactFlow
            nodes={visibleNodes}
            edges={visibleEdges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeClick={(_, node) => {
              setSelectedNodeId(node.id);
              setSelectedDialogueLineIndex(null);
              setShowAllInspectorLines(false);
            }}
            onInit={(instance) => {
              flowInstanceRef.current = instance as ReactFlowInstance<CanvasNode, CanvasEdge>;
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
              nodeColor={(n) =>
                n.type === 'labelNode'
                  ? THEMES[theme].minimapLabel
                  : n.type === 'menuNode'
                    ? THEMES[theme].minimapMenu
                    : THEMES[theme].minimapDecision
              }
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
          onToggleShowAllInspectorLines={toggleShowAllInspectorLines}
          onSetActiveDialogueResultIndex={setActiveDialogueResultIndex}
          onSelectDialogueSearchResult={onSelectDialogueSearchResult}
        />
      </div>
    </>
  );
}
