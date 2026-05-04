/**
 * src/FlowchartViewer.tsx
 *
 * Renders the parsed Ren'Py flowchart using React Flow + dagre.
 * Exports a high-resolution PNG via html-to-image.
 */

import { useCallback, useEffect, useMemo, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react';
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
import { MAX_VISIBLE_LABEL_SUBGRAPH_TOGGLES } from './ui/viewerConstants';
// ─── Main component ───────────────────────────────────────────────────────────

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

  // ── Viewer store ─────────────────────────────────────────────────────────────
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
    setSearchInput,
    setLabelSubgraphSearchInput,
    setMinDialogue,
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
    toggleShowAdvancedControls,
    toggleShowAllLabelSubgraphToggles,
    setStandaloneDialogueSearchMode,
    resetSession,
  } = useViewerStore(useShallow((s) => ({
    setLayoutDirection: s.setLayoutDirection,
    setSearchInput: s.setSearchInput,
    setLabelSubgraphSearchInput: s.setLabelSubgraphSearchInput,
    setMinDialogue: s.setMinDialogue,
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
    toggleShowAdvancedControls: s.toggleShowAdvancedControls,
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

  // ── Layout hook ──────────────────────────────────────────────────────────────
  const onRelayoutComplete = useCallback(() => {
    flowInstanceRef.current?.fitView({ padding: 0.2 });
  }, []);

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

  // ── Derived graph metadata ───────────────────────────────────────────────────
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

  // ── Search hook ──────────────────────────────────────────────────────────────
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

  // ── Visible nodes/edges ──────────────────────────────────────────────────────
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
        // eslint-disable-next-line react-hooks/refs -- intentional: ref holds an identity-preserving cache map updated in useEffect; reading it here avoids an extra render cycle (Issue 10)
        previousById: previousVisibleNodesByIdRef.current,
      }),
    [
      collapsedChapters,
      collapsedLabelChildren,
      dialogueMatchNodeIds,
      dialogueLineSearchEnabled,
      effectiveSearch,
      minDialogue,
      nodes,
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
        // eslint-disable-next-line react-hooks/refs -- intentional: ref holds an identity-preserving cache map updated in useEffect; reading it here avoids an extra render cycle (Issue 10)
        previousById: previousVisibleEdgesByIdRef.current,
      }),
    [edges, largeGraphMode, showCallReturns, theme, visibleEdgeKinds, visibleNodeIds],
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
  }, [visibleNodes]);

  useEffect(() => {
    const current = previousVisibleEdgesByIdRef.current;
    if (
      current.size === visibleEdges.length &&
      visibleEdges.every((edge) => current.get(edge.id) === edge)
    ) {
      return;
    }
    previousVisibleEdgesByIdRef.current = new Map(visibleEdges.map((edge) => [edge.id, edge]));
  }, [visibleEdges]);

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

  // ── Callbacks ────────────────────────────────────────────────────────────────
  const onExport = useCallback(() => {
    if (!flowRef.current) return;
    const startedAt = performance.now();
    const width = flowRef.current.offsetWidth;
    const height = flowRef.current.offsetHeight;
    const pixelRatio = isLargeExportTarget ? 1 : 2;
    toBlob(flowRef.current, {
      backgroundColor: THEMES[theme].pageBg,
      pixelRatio,
      width,
      height,
    })
      .then((blob) => {
        if (!blob) return;
        saveAs(blob, 'renpy-flowchart.png');
        perf.log('export_png_ms', performance.now() - startedAt, {
          nodeCount: visibleNodeIds.size,
          edgeCount: visibleEdges.length,
        });
      })
      .catch((err: unknown) => {
        console.error('Export failed:', err);
      });
  }, [isLargeExportTarget, perf, theme, visibleEdges.length, visibleNodeIds.size]);

  const onExportSvg = useCallback(() => {
    if (!flowRef.current) return;
    const startedAt = performance.now();
    const width = flowRef.current.offsetWidth;
    const height = flowRef.current.offsetHeight;
    toSvg(flowRef.current, {
      backgroundColor: THEMES[theme].pageBg,
      width,
      height,
    })
      .then((svgDataUrl) => {
        const svgBlob = dataUrlToBlob(svgDataUrl);
        saveAs(svgBlob, 'renpy-flowchart.svg');
        perf.log('export_svg_ms', performance.now() - startedAt, {
          nodeCount: visibleNodeIds.size,
          edgeCount: visibleEdges.length,
        });
      })
      .catch((err: unknown) => {
        console.error('SVG export failed:', err);
      });
  }, [perf, theme, visibleEdges.length, visibleNodeIds.size]);

  const onExportJson = useCallback(() => {
    const graphJson = JSON.stringify({ nodes: flowNodes, edges: flowEdges }, null, 2);
    const blob = new Blob([graphJson], { type: 'application/json' });
    saveAs(blob, 'renpy-flowchart.json');
  }, [flowEdges, flowNodes]);

  const onDebugOptionChange = useCallback(
    (patch: Partial<DebugBundlePrivacyOptions>) => {
      if (!onDebugPrivacyOptionsChange) return;
      onDebugPrivacyOptionsChange({ ...debugPrivacyOptions, ...patch });
    },
    [debugPrivacyOptions, onDebugPrivacyOptionsChange],
  );

  const onFitView = useCallback(() => {
    flowInstanceRef.current?.fitView({ padding: 0.2 });
  }, []);

  const onFocusSelectedNode = useCallback(() => {
    if (!focusNodeId || !flowInstanceRef.current) return;
    const target = visibleNodes.find((n) => n.id === focusNodeId && !n.hidden);
    if (!target) return;
    const center = getNodeCenter(target);
    flowInstanceRef.current.setCenter(center.x, center.y, {
      zoom: 1.1,
      duration: 250,
    });
  }, [focusNodeId, visibleNodes]);

  const focusVisibleNode = useCallback((nodeId: string) => {
    const target = visibleNodes.find((n) => n.id === nodeId && !n.hidden);
    if (!target || !flowInstanceRef.current) return;
    const center = getNodeCenter(target);
    flowInstanceRef.current.setCenter(center.x, center.y, {
      zoom: 1.1,
      duration: 250,
    });
  }, [visibleNodes]);

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

  // ── Global keyboard shortcuts ─────────────────────────────────────────────────
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

  // ── Performance tracking ──────────────────────────────────────────────────────
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

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full min-h-0" style={{ backgroundColor: THEMES[theme].pageBg, color: THEMES[theme].text }}>
      {/* Toolbar */}
      <ViewerToolbar
        theme={theme}
        visibleNodeCount={visibleNodeIds.size}
        totalNodeCount={flowNodes.length}
        visibleEdgeCount={visibleEdges.length}
        totalEdgeCount={flowEdges.length}
        searchInput={searchInput}
        setSearchInput={setSearchInput}
        searchInputRef={searchInputRef}
        onSearchInputKeyDown={onSearchInputKeyDown}
        dialogueLineSearchEnabled={dialogueLineSearchEnabled}
        minDialogue={minDialogue}
        setMinDialogue={setMinDialogue}
        selectedDialogueSearchMode={selectedDialogueSearchMode}
        onDialogueSearchModeChange={handleDialogueModeChange}
        isLargeExportTarget={isLargeExportTarget}
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

      {/* Advanced controls */}
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

      {/* Flow canvas + inspector */}
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
    </div>
  );
}
