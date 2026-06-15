import React, { useCallback, useEffect, useLayoutEffect, useMemo } from "react";
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
  buildConditionalVisibility,
  buildVisibleEdges,
  buildVisibleNodes,
  type CanvasEdge,
  type CanvasNode,
  type FlowEdge,
  type FlowNode,
  getNodeCenter,
} from "../domain/index.ts";
import {
  type DialogueSearchMode,
  type ParseService,
  useViewerStore,
} from "../application/index.ts";
import {
  INSPECTOR_DIALOGUE_TRUNCATE_DEFAULT,
  LARGE_EXPORT_GRAPH_ELEMENTS_THRESHOLD,
  LARGE_GRAPH_EDGE_THRESHOLD,
  LARGE_GRAPH_NODE_THRESHOLD,
} from "../config/viewerConfig.ts";

import type { createPerfTracker } from "../infrastructure/index.ts";
import { THEMES } from "./viewerTheme.ts";
import { edgeTypes, nodeTypes } from "./viewerReactFlowRegistry.ts";
import type { DialogueSearchResult } from "../infrastructure/index.ts";
import { useViewerLayout } from "./hooks/useViewerLayout.ts";
import { useViewerSearch } from "./hooks/useViewerSearch.ts";
import * as Dialog from "@radix-ui/react-dialog";
import { ViewerAdvancedControls } from "./ViewerAdvancedControls.tsx";
import { ViewerInspector } from "./viewerInspector.tsx";
import { MAX_VISIBLE_LABEL_SUBGRAPH_TOGGLES } from "./viewerConstants.ts";
import type { CanvasCallbacksRegistry, CanvasMetrics } from "./canvasTypes.ts";
import { deriveCollapsedLabelChildren } from "./canvasHelpers.ts";
import { cn } from "./utils/cn.ts";

export interface FlowchartCanvasProps {
  flowNodes: FlowNode[];
  flowEdges: FlowEdge[];
  flowRef: React.RefObject<HTMLDivElement | null>;
  flowInstanceRef: React.MutableRefObject<
    ReactFlowInstance<CanvasNode, CanvasEdge> | null
  >;
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
    layoutDensity,
    selectedSearchChapter,
    selectedSearchNodeKinds,
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
    layoutDensity: s.layoutDensity,
    selectedSearchChapter: s.selectedSearchChapter,
    selectedSearchNodeKinds: s.selectedSearchNodeKinds,
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
    setShowAdvancedControls,
    toggleShowAllLabelSubgraphToggles,
    setStandaloneDialogueSearchMode,
    setMockFlag,
    resetMockFlags,
    setConditionVisibilityMode,
    resetSession,
    setLayoutDensity,
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
    setShowAdvancedControls: s.setShowAdvancedControls,
    toggleShowAllLabelSubgraphToggles: s.toggleShowAllLabelSubgraphToggles,
    setStandaloneDialogueSearchMode: s.setStandaloneDialogueSearchMode,
    setMockFlag: s.setMockFlag,
    resetMockFlags: s.resetMockFlags,
    setConditionVisibilityMode: s.setConditionVisibilityMode,
    resetSession: s.resetSession,
    setLayoutDensity: s.setLayoutDensity,
  })));

  const isDark = theme === "dark";

  // Reset session state when this component unmounts (e.g. on new import).
  useEffect(() => () => resetSession(), [resetSession]);

  useEffect(() => {
    setStandaloneDialogueSearchMode(dialogueSearchMode);
  }, [dialogueSearchMode, setStandaloneDialogueSearchMode]);

  const selectedDialogueSearchMode = onDialogueSearchModeChange
    ? dialogueSearchMode
    : standaloneDialogueSearchMode;

  const autoLargeGraphMode = useMemo(
    () =>
      flowNodes.length > LARGE_GRAPH_NODE_THRESHOLD ||
      flowEdges.length > LARGE_GRAPH_EDGE_THRESHOLD,
    [flowEdges.length, flowNodes.length],
  );
  const largeGraphMode = largeGraphModeOverride ?? autoLargeGraphMode;

  const effectiveDialogueSearchMode = useMemo<DialogueSearchMode>(
    () =>
      selectedDialogueSearchMode === "auto"
        ? (autoLargeGraphMode ? "countOnly" : "full")
        : selectedDialogueSearchMode,
    [autoLargeGraphMode, selectedDialogueSearchMode],
  );
  const dialogueLineSearchEnabled = effectiveDialogueSearchMode === "full";

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
    isCalculatingLayout,
  } = useViewerLayout({
    flowNodes,
    flowEdges,
    layoutDirection,
    layoutDensity,
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
    () => flowNodes.filter((n) => n.type === "LABEL").map((n) => n.id).sort(),
    [flowNodes],
  );

  const labelSubgraphSearch = labelSubgraphSearchInput.trim().toLowerCase();
  const visibleSubgraphLabels = useMemo(
    () =>
      labels.filter((label) =>
        labelSubgraphSearch.length === 0
          ? true
          : label.toLowerCase().includes(labelSubgraphSearch)
      ),
    [labelSubgraphSearch, labels],
  );

  const collapsedLabelCount = useMemo(
    () => labels.filter((label) => collapsedParentLabels[label]).length,
    [collapsedParentLabels, labels],
  );

  const shouldShowAllLabelSubgraphToggles = showAllLabelSubgraphToggles &&
    visibleSubgraphLabels.length > MAX_VISIBLE_LABEL_SUBGRAPH_TOGGLES;

  const visibleLabelSubgraphToggles = useMemo(
    () =>
      shouldShowAllLabelSubgraphToggles
        ? visibleSubgraphLabels
        : visibleSubgraphLabels.slice(0, MAX_VISIBLE_LABEL_SUBGRAPH_TOGGLES),
    [shouldShowAllLabelSubgraphToggles, visibleSubgraphLabels],
  );

  const largeGraphModeStatusText = useMemo(() => {
    if (autoLargeGraphMode && largeGraphModeOverride === null) {
      return "Auto-enabled from graph size.";
    }
    if (autoLargeGraphMode && largeGraphModeOverride !== null) {
      return "Auto-detected large graph; manual override active.";
    }
    if (!autoLargeGraphMode && largeGraphModeOverride === true) {
      return "Manually enabled.";
    }
    return "Off.";
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
    selectedSearchChapter,
    selectedSearchNodeKinds,
  });

  // -- Visible nodes/edges ----------------------------------------------------
  const visibleNodes = useMemo(
    () =>
      buildVisibleNodes({
        nodes,
        search: effectiveSearch,
        searchMatchNodeIds,
        includeDialogueLineSearch: false,
        dialogueMatchNodeIds: dialogueLineSearchEnabled
          ? dialogueMatchNodeIds
          : null,
        minDialogue,
        collapsedChapters,
        collapsedLabelChildren,
        conditionHiddenNodeIds: conditionVisibilityMode === "hide"
          ? conditionalVisibility.hiddenNodeIds
          : undefined,
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
        decisionColor: THEMES[theme].decisionBorder,
        labelColor: THEMES[theme].labelBorder,
        menuColor: THEMES[theme].menuBorder,
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
    previousVisibleNodesByIdRef.current = new Map(
      visibleNodes.map((node) => [node.id, node]),
    );
  }, [previousVisibleNodesByIdRef, visibleNodes]);

  useEffect(() => {
    const current = previousVisibleEdgesByIdRef.current;
    if (
      current.size === visibleEdges.length &&
      visibleEdges.every((edge) => current.get(edge.id) === edge)
    ) {
      return;
    }
    previousVisibleEdgesByIdRef.current = new Map(
      visibleEdges.map((edge) => [edge.id, edge]),
    );
  }, [previousVisibleEdgesByIdRef, visibleEdges]);

  const selectedNode = useMemo(
    () =>
      visibleNodes.find((n) => n.id === selectedNodeId && !n.hidden) ?? null,
    [selectedNodeId, visibleNodes],
  );

  const selectedNodeData = selectedNode?.data as {
    label?: string;
    dialogueCount?: number;
    dialogueLines?: string[];
    audioAssetCues?: import("../domain/graph.ts").AudioAssetCue[];
  } | undefined;

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
    if (activeDialogueResultIndex >= activeDialogueSearchResults.length) {
      return activeDialogueSearchResults.length - 1;
    }
    return activeDialogueResultIndex;
  }, [activeDialogueResultIndex, activeDialogueSearchResults.length]);

  const isLargeExportTarget = useMemo(
    () =>
      visibleNodeIds.size + visibleEdges.length >=
        LARGE_EXPORT_GRAPH_ELEMENTS_THRESHOLD,
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

  const onSelectDialogueSearchResult = useCallback(
    (result: DialogueSearchResult) => {
      const targetNode = visibleNodes.find((node) =>
        node.id === result.nodeId && !node.hidden
      );
      const targetNodeData = targetNode?.data as
        | { dialogueLines?: string[] }
        | undefined;
      const totalLines = targetNodeData?.dialogueLines?.length ?? 0;
      const selectedLineOutsidePreview =
        result.lineIndex > INSPECTOR_DIALOGUE_TRUNCATE_DEFAULT;
      const hasTruncation = totalLines > INSPECTOR_DIALOGUE_TRUNCATE_DEFAULT;
      setSelectedNodeId(result.nodeId);
      setSelectedDialogueLineIndex(result.lineIndex);
      setShowAllInspectorLines(hasTruncation && selectedLineOutsidePreview);
      focusVisibleNode(result.nodeId);
    },
    [
      focusVisibleNode,
      setSelectedNodeId,
      setSelectedDialogueLineIndex,
      setShowAllInspectorLines,
      visibleNodes,
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
  }, [
    dialogueLineSearchEnabled,
    isLargeExportTarget,
    onMetrics,
    visibleEdges.length,
    visibleNodeIds.size,
  ]);

  // -- Performance tracking ---------------------------------------------------
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

  // -- Render -----------------------------------------------------------------
  return (
    <>
      <Dialog.Root
        open={showAdvancedControls}
        onOpenChange={setShowAdvancedControls}
        modal={false}
      >
        <Dialog.Portal>
          {/* Radix does not render Dialog.Overlay in non-modal mode — use a plain div instead */}
          <div
            className="fixed inset-0 bg-black/45 backdrop-blur-sm z-50 animate-fade-in"
            aria-hidden="true"
          />
          <Dialog.Content
            className={cn(
              "fixed right-0 top-0 bottom-0 w-full max-w-md shadow-2xl z-50 flex flex-col focus:outline-none animate-slide-in transition-colors duration-200",
              isDark
                ? "bg-slate-900 border-l border-slate-800 text-slate-100"
                : "bg-white text-gray-900",
            )}
            aria-modal="true"
            onInteractOutside={(e) => e.preventDefault()}
          >
            <div
              className={cn(
                "flex items-center justify-between px-6 py-4 border-b shrink-0 transition-colors duration-200",
                isDark
                  ? "border-slate-800 bg-slate-850"
                  : "border-gray-100 bg-gray-50/50",
              )}
            >
              <div>
                <Dialog.Title
                  className={cn(
                    "text-base font-semibold",
                    isDark ? "text-slate-100" : "text-gray-900",
                  )}
                >
                  Advanced Settings
                </Dialog.Title>
                <Dialog.Description
                  className={cn(
                    "text-xs mt-0.5",
                    isDark ? "text-slate-400" : "text-gray-500",
                  )}
                >
                  Configure graph layouts, filters, themes, and path
                  simulations.
                </Dialog.Description>
              </div>
              <Dialog.Close asChild>
                <button
                  type="button"
                  className={cn(
                    "rounded-full p-1.5 transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-violet-500",
                    isDark
                      ? "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                      : "text-gray-400 hover:bg-gray-100 hover:text-gray-700",
                  )}
                  aria-label="Close advanced controls"
                >
                  <svg
                    className="w-5 h-5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </button>
              </Dialog.Close>
            </div>
            <div
              className={cn(
                "flex-1 overflow-y-auto px-6 py-4",
                isDark ? "bg-slate-900" : "bg-white",
              )}
            >
              <ViewerAdvancedControls
                layoutDirection={layoutDirection}
                setLayoutDirection={setLayoutDirection}
                layoutDensity={layoutDensity}
                setLayoutDensity={setLayoutDensity}
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
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <div className="flex-1 flex flex-col xl:flex-row min-h-0">
        <div
          ref={flowRef}
          className="flex-1 min-h-[320px] relative"
          style={{ backgroundColor: THEMES[theme].pageBg }}
        >
          {isCalculatingLayout && (
            <div className="absolute inset-0 bg-white/45 backdrop-blur-md z-30 flex flex-col items-center justify-center animate-fade-in pointer-events-auto select-none">
              <div className="flex flex-col items-center gap-3">
                <div
                  className="w-10 h-10 border-4 border-t-transparent rounded-full animate-spin"
                  style={{
                    borderColor: `${THEMES[theme].labelBorder}22`,
                    borderTopColor: THEMES[theme].labelBorder,
                  }}
                />
                <div className="text-center">
                  <p
                    className="text-sm font-semibold text-gray-950"
                    style={{ color: THEMES[theme].text }}
                  >
                    Generating Flowchart Layout
                  </p>
                  <p
                    className="text-xs text-gray-500 mt-1"
                    style={{ color: THEMES[theme].subtleText }}
                  >
                    Optimizing nodes and branching paths...
                  </p>
                </div>
              </div>
            </div>
          )}
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
              flowInstanceRef.current = instance as ReactFlowInstance<
                CanvasNode,
                CanvasEdge
              >;
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
          onToggleShowAllInspectorLines={toggleShowAllInspectorLines}
          onSetActiveDialogueResultIndex={setActiveDialogueResultIndex}
          onSelectDialogueSearchResult={onSelectDialogueSearchResult}
        />
      </div>
    </>
  );
}
