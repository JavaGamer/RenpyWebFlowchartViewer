/**
 * src/FlowchartViewer.tsx
 *
 * Renders the parsed Ren'Py flowchart using React Flow + dagre.
 * Exports a high-resolution PNG via html-to-image.
 */

import React, { useState, useCallback, useEffect, useLayoutEffect, useMemo, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type ReactFlowInstance,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { toBlob, toSvg } from 'html-to-image';
import { saveAs } from 'file-saver';
import { ErrorBoundary } from 'react-error-boundary';
import { useShallow } from 'zustand/react/shallow';
import type { FlowNode, FlowEdge } from './domain';
import {
  DEFAULT_DEBUG_BUNDLE_PRIVACY_OPTIONS,
  type DialogueSearchMode,
  type ParseService,
  type DebugBundlePrivacyOptions,
  useViewerStore,
  workerParseService,
} from './application';
import {
  LARGE_EXPORT_GRAPH_ELEMENTS_THRESHOLD,
  INSPECTOR_DIALOGUE_TRUNCATE_DEFAULT,
  LARGE_GRAPH_EDGE_THRESHOLD,
  LARGE_GRAPH_NODE_THRESHOLD,
} from './config/viewerConfig';

import {
  type CanvasNode,
  type CanvasEdge,
  buildVisibleEdges,
  buildVisibleNodes,
  getNodeCenter,
} from './flowchartTransforms';
import { createPerfTracker } from './perf';
import { THEMES } from './ui/viewerTheme';
import { nodeTypes, edgeTypes } from './ui/viewerReactFlowRegistry';
import type { DialogueSearchResult } from './infrastructure';
import { useViewerLayout } from './hooks/useViewerLayout';
import { useViewerSearch } from './hooks/useViewerSearch';
import { ViewerToolbar } from './ui/ViewerToolbar';
import { ViewerAdvancedControls } from './ui/ViewerAdvancedControls';
import { ViewerInspector } from './ui/viewerInspector';
import { CONTROL_BUTTON_CLASS, MAX_VISIBLE_LABEL_SUBGRAPH_TOGGLES } from './ui/viewerConstants';

// --- Canvas error fallback ---------------------------------------------------

function CanvasErrorFallback({
  error,
  resetErrorBoundary,
}: {
  error: unknown;
  resetErrorBoundary: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex-1 flex flex-col items-center justify-center gap-4 p-8 text-center min-h-[320px]"
    >
      <p className="text-sm font-medium text-red-700">The chart view encountered an error.</p>
      {error instanceof Error && (
        <pre className="text-xs text-left bg-gray-100 rounded p-3 max-w-md overflow-auto">
          {error.message}
        </pre>
      )}
      <button type="button" className={CONTROL_BUTTON_CLASS} onClick={resetErrorBoundary}>
        Try again
      </button>
    </div>
  );
}

// --- Shared types ------------------------------------------------------------

interface CanvasMetrics {
  visibleNodeCount: number;
  visibleEdgeCount: number;
  dialogueLineSearchEnabled: boolean;
  isLargeExportTarget: boolean;
}

// The inner component writes its current onSearchInputKeyDown to this registry
// on each render so the outer stable wrapper always calls the latest version.
interface CanvasCallbacksRegistry {
  onSearchInputKeyDown: (e: ReactKeyboardEvent<HTMLInputElement>) => void;
}

// --- Helpers -----------------------------------------------------------------

function deriveCollapsedLabelChildren(
  nodes: FlowNode[],
  collapsedParentLabels: Record<string, boolean>,
): Set<string> {
  const collapsedChildren = new Set<string>();
  for (const node of nodes) {
    if (node.type !== 'MENU') continue;
    if (!node.parentLabelId) continue;
    if (!collapsedParentLabels[node.parentLabelId]) continue;
    collapsedChildren.add(node.id);
  }
  return collapsedChildren;
}

function dataUrlToBlob(dataUrl: string): Blob {
  const commaIdx = dataUrl.indexOf(',');
  const meta = commaIdx >= 0 ? dataUrl.slice(0, commaIdx) : dataUrl;
  const data = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : '';
  const isBase64 = meta.includes(';base64');
  const mimeMatch = meta.match(/data:([^;]+)/);
  const mimeType = mimeMatch?.[1] ?? 'application/octet-stream';
  if (isBase64) {
    const decoded = atob(data);
    const bytes = new Uint8Array(decoded.length);
    for (let i = 0; i < decoded.length; i += 1) {
      bytes[i] = decoded.charCodeAt(i);
    }
    return new Blob([bytes], { type: mimeType });
  }
  try {
    return new Blob([decodeURIComponent(data)], { type: mimeType });
  } catch {
    return new Blob([data], { type: mimeType });
  }
}

// --- Inner canvas component --------------------------------------------------
// This component is wrapped in ErrorBoundary by FlowchartViewer, so any error
// thrown by layout hooks, graph-derivation, or ReactFlow rendering is contained
// here. The outer toolbar survives any such failure.

interface FlowchartCanvasProps {
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

function FlowchartCanvas({
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
  } = useViewerStore(useShallow((s) => ({
    layoutDirection: s.layoutDirection,
    searchInput: s.searchInput,
    labelSubgraphSearchInput: s.labelSubgraphSearchInput,
    minDialogue: s.minDialogue,
    theme: s.theme,
    collapsedChapters: s.collapsedChapters,
    collapsedParentLabels: s.collapsedParentLabels,
    showCallReturns: s.showCallReturns,
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
  })));
  const {
    setLayoutDirection,
    setLabelSubgraphSearchInput,
    setTheme,
    toggleChapter,
    toggleParentLabel,
    setAllParentLabelsCollapsed,
    setShowCallReturns,
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
    resetSession,
  } = useViewerStore(useShallow((s) => ({
    setLayoutDirection: s.setLayoutDirection,
    setLabelSubgraphSearchInput: s.setLabelSubgraphSearchInput,
    setTheme: s.setTheme,
    toggleChapter: s.toggleChapter,
    toggleParentLabel: s.toggleParentLabel,
    setAllParentLabelsCollapsed: s.setAllParentLabelsCollapsed,
    setShowCallReturns: s.setShowCallReturns,
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
        // eslint-disable-next-line react-hooks/refs -- intentional: same pattern as above (Issue 10)
        previousById: previousVisibleEdgesByIdRef.current,
      }),
    // previousVisibleEdgesByIdRef is a stable ref — including it here does not cause extra
    // renders but satisfies exhaustive-deps (Issue 10).
    [edges, largeGraphMode, previousVisibleEdgesByIdRef, showCallReturns, theme, visibleEdgeKinds, visibleNodeIds],
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

  const selectedNodeData = selectedNode?.data as { label?: string; dialogueCount?: number; dialogueLines?: string[] } | undefined;

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

  const onSearchInputKeyDown = useCallback((event: ReactKeyboardEvent<HTMLInputElement>) => {
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
  // the latest version after every commit, without causing extra renders.
  useLayoutEffect(() => {
    canvasCallbacksRef.current.onSearchInputKeyDown = onSearchInputKeyDown;
  });

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
        <div className="px-3 sm:px-4 pb-3 bg-white border-b border-gray-200 shrink-0">
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
                n.type === 'labelNode' ? THEMES[theme].minimapLabel : THEMES[theme].minimapMenu
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

// --- Outer shell -------------------------------------------------------------
// The toolbar lives outside the ErrorBoundary so it continues to function
// even when FlowchartCanvas (layout, derivation, rendering) crashes.

interface FlowchartViewerProps {
  flowNodes: FlowNode[];
  flowEdges: FlowEdge[];
  dialogueSearchMode?: DialogueSearchMode;
  onDialogueSearchModeChange?: (mode: DialogueSearchMode) => void;
  parseService?: ParseService;
  debugPrivacyOptions?: DebugBundlePrivacyOptions;
  onDebugPrivacyOptionsChange?: (options: DebugBundlePrivacyOptions) => void;
  onExportDebugBundle?: (options: DebugBundlePrivacyOptions) => void;
  onOpenIssue?: (options: DebugBundlePrivacyOptions) => void;
}

export default function FlowchartViewer({
  flowNodes,
  flowEdges,
  dialogueSearchMode = 'auto',
  onDialogueSearchModeChange,
  parseService = workerParseService,
  debugPrivacyOptions = DEFAULT_DEBUG_BUNDLE_PRIVACY_OPTIONS,
  onDebugPrivacyOptionsChange,
  onExportDebugBundle,
  onOpenIssue,
}: FlowchartViewerProps) {
  const perf = useMemo(() => createPerfTracker('viewer'), []);
  const flowRef = useRef<HTMLDivElement>(null);
  const flowInstanceRef = useRef<ReactFlowInstance<CanvasNode, CanvasEdge> | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Issue 10: useRef instead of useState for identity-preserving cache maps
  const previousVisibleNodesByIdRef = useRef<Map<string, CanvasNode>>(new Map());
  const previousVisibleEdgesByIdRef = useRef<Map<string, CanvasEdge>>(new Map());

  // Registry ref: inner component writes current onSearchInputKeyDown here;
  // outer provides a stable wrapper that calls it.
  const canvasCallbacksRef = useRef<CanvasCallbacksRegistry>({
    onSearchInputKeyDown: () => {},
  });
  const onSearchInputKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLInputElement>) => canvasCallbacksRef.current.onSearchInputKeyDown(e),
    [],
  );

  // -- Minimal store reads for toolbar ----------------------------------------
  const {
    searchInput,
    minDialogue,
    theme,
    showAdvancedControls,
    standaloneDialogueSearchMode,
  } = useViewerStore(useShallow((s) => ({
    searchInput: s.searchInput,
    minDialogue: s.minDialogue,
    theme: s.theme,
    showAdvancedControls: s.showAdvancedControls,
    standaloneDialogueSearchMode: s.standaloneDialogueSearchMode,
  })));
  const {
    setSearchInput,
    setMinDialogue,
    toggleShowAdvancedControls,
    setStandaloneDialogueSearchMode,
  } = useViewerStore(useShallow((s) => ({
    setSearchInput: s.setSearchInput,
    setMinDialogue: s.setMinDialogue,
    toggleShowAdvancedControls: s.toggleShowAdvancedControls,
    setStandaloneDialogueSearchMode: s.setStandaloneDialogueSearchMode,
  })));

  // -- Canvas metrics ---------------------------------------------------------
  // Seeded with totals; refined once FlowchartCanvas reports its first render.
  const [canvasMetrics, setCanvasMetrics] = useState<CanvasMetrics>({
    visibleNodeCount: flowNodes.length,
    visibleEdgeCount: flowEdges.length,
    dialogueLineSearchEnabled: false,
    isLargeExportTarget: false,
  });

  // -- Dialogue mode ----------------------------------------------------------
  const selectedDialogueSearchMode = onDialogueSearchModeChange
    ? dialogueSearchMode
    : standaloneDialogueSearchMode;

  const handleDialogueModeChange = useCallback(
    (mode: DialogueSearchMode) => {
      if (onDialogueSearchModeChange) {
        onDialogueSearchModeChange(mode);
      } else {
        setStandaloneDialogueSearchMode(mode);
      }
    },
    [onDialogueSearchModeChange, setStandaloneDialogueSearchMode],
  );

  // -- Toolbar callbacks ------------------------------------------------------
  const onExportJson = useCallback(() => {
    const graphJson = JSON.stringify({ nodes: flowNodes, edges: flowEdges }, null, 2);
    const blob = new Blob([graphJson], { type: 'application/json' });
    saveAs(blob, 'renpy-flowchart.json');
  }, [flowEdges, flowNodes]);

  const onExport = useCallback(() => {
    if (!flowRef.current) return;
    const startedAt = performance.now();
    const { isLargeExportTarget, visibleNodeCount, visibleEdgeCount } = canvasMetrics;
    const pixelRatio = isLargeExportTarget ? 1 : 2;
    toBlob(flowRef.current, {
      backgroundColor: THEMES[theme].pageBg,
      pixelRatio,
      width: flowRef.current.offsetWidth,
      height: flowRef.current.offsetHeight,
    })
      .then((blob) => {
        if (!blob) return;
        saveAs(blob, 'renpy-flowchart.png');
        perf.log('export_png_ms', performance.now() - startedAt, {
          nodeCount: visibleNodeCount,
          edgeCount: visibleEdgeCount,
        });
      })
      .catch((err: unknown) => {
        console.error('Export failed:', err);
      });
  }, [canvasMetrics, perf, theme]);

  const onExportSvg = useCallback(() => {
    if (!flowRef.current) return;
    const startedAt = performance.now();
    const { visibleNodeCount, visibleEdgeCount } = canvasMetrics;
    toSvg(flowRef.current, {
      backgroundColor: THEMES[theme].pageBg,
      width: flowRef.current.offsetWidth,
      height: flowRef.current.offsetHeight,
    })
      .then((svgDataUrl) => {
        const svgBlob = dataUrlToBlob(svgDataUrl);
        saveAs(svgBlob, 'renpy-flowchart.svg');
        perf.log('export_svg_ms', performance.now() - startedAt, {
          nodeCount: visibleNodeCount,
          edgeCount: visibleEdgeCount,
        });
      })
      .catch((err: unknown) => {
        console.error('SVG export failed:', err);
      });
  }, [canvasMetrics, perf, theme]);

  const onFitView = useCallback(() => {
    flowInstanceRef.current?.fitView({ padding: 0.2 });
  }, []);

  const onDebugOptionChange = useCallback(
    (patch: Partial<DebugBundlePrivacyOptions>) => {
      if (!onDebugPrivacyOptionsChange) return;
      onDebugPrivacyOptionsChange({ ...debugPrivacyOptions, ...patch });
    },
    [debugPrivacyOptions, onDebugPrivacyOptionsChange],
  );

  // -- Global keyboard shortcuts ----------------------------------------------
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'e') {
        event.preventDefault();
        onExport();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'l') {
        event.preventDefault();
        flowInstanceRef.current?.fitView({ padding: 0.2 });
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onExport]);

  // -- Render -----------------------------------------------------------------
  return (
    <div className="flex flex-col h-full min-h-0" style={{ backgroundColor: THEMES[theme].pageBg, color: THEMES[theme].text }}>
      {/* Toolbar - always rendered, even when the canvas has errored */}
      <ViewerToolbar
        theme={theme}
        visibleNodeCount={canvasMetrics.visibleNodeCount}
        totalNodeCount={flowNodes.length}
        visibleEdgeCount={canvasMetrics.visibleEdgeCount}
        totalEdgeCount={flowEdges.length}
        searchInput={searchInput}
        setSearchInput={setSearchInput}
        searchInputRef={searchInputRef}
        onSearchInputKeyDown={onSearchInputKeyDown}
        dialogueLineSearchEnabled={canvasMetrics.dialogueLineSearchEnabled}
        minDialogue={minDialogue}
        setMinDialogue={setMinDialogue}
        selectedDialogueSearchMode={selectedDialogueSearchMode}
        onDialogueSearchModeChange={handleDialogueModeChange}
        isLargeExportTarget={canvasMetrics.isLargeExportTarget}
        onExport={onExport}
        onExportSvg={onExportSvg}
        onExportJson={onExportJson}
        onExportDebugBundle={onExportDebugBundle}
        onOpenIssue={onOpenIssue}
        debugPrivacyOptions={debugPrivacyOptions}
        onDebugOptionChange={onDebugOptionChange}
        onFitView={onFitView}
        onZoomTo={(preset) => flowInstanceRef.current?.zoomTo(preset, { duration: 250 })}
        showAdvancedControls={showAdvancedControls}
        toggleShowAdvancedControls={toggleShowAdvancedControls}
      />

      {/* ErrorBoundary wraps FlowchartCanvas so errors from layout hooks,
          graph-derivation, or ReactFlow rendering are all contained here.
          The toolbar above continues to function after any such error. */}
      <ErrorBoundary FallbackComponent={CanvasErrorFallback}>
        <FlowchartCanvas
          flowNodes={flowNodes}
          flowEdges={flowEdges}
          flowRef={flowRef}
          flowInstanceRef={flowInstanceRef}
          searchInputRef={searchInputRef}
          previousVisibleNodesByIdRef={previousVisibleNodesByIdRef}
          previousVisibleEdgesByIdRef={previousVisibleEdgesByIdRef}
          canvasCallbacksRef={canvasCallbacksRef}
          parseService={parseService}
          dialogueSearchMode={dialogueSearchMode}
          onDialogueSearchModeChange={onDialogueSearchModeChange}
          perf={perf}
          onMetrics={setCanvasMetrics}
        />
      </ErrorBoundary>
    </div>
  );
}
