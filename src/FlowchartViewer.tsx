/**
 * src/FlowchartViewer.tsx
 *
 * Renders the parsed Ren'Py flowchart using React Flow + dagre.
 * Exports a high-resolution PNG via html-to-image.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type ReactFlowInstance,
  useNodesState,
  useEdgesState,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import Fuse from 'fuse.js';
import { toBlob, toSvg } from 'html-to-image';
import { Download, Search, ZoomIn, LayoutGrid, Palette, LocateFixed } from 'lucide-react';
import { saveAs } from 'file-saver';
import { useVirtualizer } from '@tanstack/react-virtual';
import debounce from 'lodash.debounce';
import type { FlowNode, FlowEdge } from './domain';
import type { DialogueSearchMode, ParseService } from './application';
import { workerParseService } from './application';
import { STORAGE_KEYS } from './config/storageKeys';
import {
  LARGE_EXPORT_GRAPH_ELEMENTS_THRESHOLD,
  INSPECTOR_DIALOGUE_TRUNCATE_DEFAULT,
  LARGE_GRAPH_EDGE_THRESHOLD,
  LARGE_GRAPH_NODE_THRESHOLD,
  SEARCH_DEBOUNCE_MS,
  ZOOM_PRESETS,
} from './config/viewerConfig';
import { DIALOGUE_FUSE_OPTIONS, NODE_FUSE_OPTIONS, type DialogueSearchDocument, type NodeSearchDocument } from './config/searchConfig';
import type { ThemeName, LayoutDirection } from './ui/viewerTypes';
import {
  type CanvasNode,
  type CanvasEdge,
  type EdgeKindFilter,
  applyDagreLayout,
  buildVisibleEdges,
  buildVisibleNodes,
  getNodeCenter,
  PROGRESSIVE_LAYOUT_NODE_LIMIT,
} from './flowchartTransforms';
import { createPerfTracker } from './perf';
import { THEMES } from './ui/viewerTheme';
import { nodeTypes, edgeTypes } from './ui/viewerReactFlowRegistry';
import type { DialogueSearchResult } from './infrastructure';
// ─── Main component ───────────────────────────────────────────────────────────

interface FlowchartViewerProps {
  flowNodes: FlowNode[];
  flowEdges: FlowEdge[];
  dialogueSearchMode?: DialogueSearchMode;
  onDialogueSearchModeChange?: (mode: DialogueSearchMode) => void;
  parseService?: ParseService;
}

const CONTROL_INPUT_CLASS =
  'px-2 py-1.5 border border-gray-300 rounded-md text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500';
const CONTROL_BUTTON_CLASS =
  'px-2 py-1.5 text-xs border border-gray-300 rounded-md hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 disabled:opacity-50 disabled:cursor-not-allowed';
const PRIMARY_BUTTON_CLASS =
  'flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500';
const MAX_VISIBLE_LABEL_SUBGRAPH_TOGGLES = 24;

function getStoredValue(key: string): string | null {
  try {
    if (typeof globalThis.localStorage === 'undefined') return null;
    return globalThis.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function setStoredValue(key: string, value: string): void {
  try {
    if (typeof globalThis.localStorage === 'undefined') return;
    globalThis.localStorage.setItem(key, value);
  } catch {
    // Ignore storage write failures (e.g., restricted/privacy modes).
  }
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

function truncateForAria(text: string, maxLength = 80): string {
  const normalized = text.trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1)}…`;
}

function renderHighlightedText(text: string, query: string) {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) return text;
  const lowerText = text.toLowerCase();
  const lowerQuery = normalizedQuery.toLowerCase();
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let key = 0;

  while (cursor < text.length) {
    const matchIndex = lowerText.indexOf(lowerQuery, cursor);
    if (matchIndex === -1) {
      nodes.push(text.slice(cursor));
      break;
    }
    if (matchIndex > cursor) {
      nodes.push(text.slice(cursor, matchIndex));
    }
    const matched = text.slice(matchIndex, matchIndex + normalizedQuery.length);
    const markKey = `hl-${key}`;
    key += 1;
    nodes.push(
      <mark key={markKey} className="bg-yellow-200 text-inherit rounded px-0.5">
        {matched}
      </mark>,
    );
    cursor = matchIndex + normalizedQuery.length;
  }

  return nodes;
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [meta, data] = dataUrl.split(',');
  const isBase64 = meta?.includes(';base64');
  const mimeMatch = meta?.match(/data:([^;]+)/);
  const mimeType = mimeMatch?.[1] ?? 'application/octet-stream';
  if (isBase64) {
    const decoded = atob(data ?? '');
    const bytes = new Uint8Array(decoded.length);
    for (let i = 0; i < decoded.length; i += 1) {
      bytes[i] = decoded.charCodeAt(i);
    }
    return new Blob([bytes], { type: mimeType });
  }
  return new Blob([decodeURIComponent(data ?? '')], { type: mimeType });
}

export default function FlowchartViewer({
  flowNodes,
  flowEdges,
  dialogueSearchMode = 'auto',
  onDialogueSearchModeChange,
  parseService = workerParseService,
}: FlowchartViewerProps) {
  const perf = useMemo(() => createPerfTracker('viewer'), []);
  const flowRef = useRef<HTMLDivElement>(null);
  const flowInstanceRef = useRef<ReactFlowInstance<CanvasNode, CanvasEdge> | null>(null);
  const [layoutDirection, setLayoutDirection] = useState<LayoutDirection>('TB');
  const [searchInput, setSearchInput] = useState('');
  const [labelSubgraphSearchInput, setLabelSubgraphSearchInput] = useState('');
  const [minDialogue, setMinDialogue] = useState(0);
  const [theme, setTheme] = useState<ThemeName>(() => {
    const raw = getStoredValue(STORAGE_KEYS.theme);
    if (raw === 'violet' || raw === 'highContrast' || raw === 'colorblind') return raw;
    return 'violet';
  });
  const [collapsedChapters, setCollapsedChapters] = useState<Record<string, boolean>>({});
  const [collapsedParentLabels, setCollapsedParentLabels] = useState<Record<string, boolean>>({});
  const [showCallReturns, setShowCallReturns] = useState(
    () => getStoredValue(STORAGE_KEYS.showCallReturns) === 'true',
  );
  const [visibleEdgeKinds, setVisibleEdgeKinds] = useState<Record<EdgeKindFilter, boolean>>(() => ({
    sequence: getStoredValue(STORAGE_KEYS.edgeSequence) !== 'false',
    jump: getStoredValue(STORAGE_KEYS.edgeJump) !== 'false',
    call: getStoredValue(STORAGE_KEYS.edgeCall) !== 'false',
    call_return: getStoredValue(STORAGE_KEYS.edgeCallReturn) !== 'false',
  }));
  const [focusNodeId, setFocusNodeId] = useState<string>('');
  const [largeGraphModeOverride, setLargeGraphModeOverride] = useState<boolean | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string>('');
  const [selectedDialogueLineIndex, setSelectedDialogueLineIndex] = useState<number | null>(null);
  const [showAllInspectorLines, setShowAllInspectorLines] = useState(false);
  const [activeDialogueResultIndex, setActiveDialogueResultIndex] = useState(-1);
  const [dialogueSearchResults, setDialogueSearchResults] = useState<DialogueSearchResult[]>([]);
  const [showAdvancedControls, setShowAdvancedControls] = useState(false);
  const [showAllLabelSubgraphToggles, setShowAllLabelSubgraphToggles] = useState(false);
  const searchAbortControllerRef = useRef<AbortController | null>(null);
  const dialogueResultsScrollRef = useRef<HTMLDivElement | null>(null);
  const inspectorLinesScrollRef = useRef<HTMLDivElement | null>(null);
  const nodePositionsRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const [previousVisibleNodesById, setPreviousVisibleNodesById] = useState<Map<string, CanvasNode>>(
    new Map(),
  );
  const [previousVisibleEdgesById, setPreviousVisibleEdgesById] = useState<Map<string, CanvasEdge>>(
    new Map(),
  );
  const searchInputRef = useRef<HTMLInputElement>(null);
  const autoLargeGraphMode = useMemo(
    () => flowNodes.length > LARGE_GRAPH_NODE_THRESHOLD || flowEdges.length > LARGE_GRAPH_EDGE_THRESHOLD,
    [flowEdges.length, flowNodes.length],
  );
  const largeGraphMode = largeGraphModeOverride ?? autoLargeGraphMode;
  const [standaloneDialogueSearchMode, setStandaloneDialogueSearchMode] =
    useState<DialogueSearchMode>(dialogueSearchMode);
  useEffect(() => {
    setStandaloneDialogueSearchMode(dialogueSearchMode);
  }, [dialogueSearchMode]);
  const selectedDialogueSearchMode = onDialogueSearchModeChange
    ? dialogueSearchMode
    : standaloneDialogueSearchMode;
  const effectiveDialogueSearchMode = useMemo<DialogueSearchMode>(
    () =>
      selectedDialogueSearchMode === 'auto'
        ? (autoLargeGraphMode ? 'countOnly' : 'full')
        : selectedDialogueSearchMode,
    [autoLargeGraphMode, selectedDialogueSearchMode],
  );
  const dialogueLineSearchEnabled = effectiveDialogueSearchMode === 'full';
  const [debouncedSearch, setDebouncedSearch] = useState(searchInput);
  const debouncedSetSearch = useMemo(
    () => debounce((value: string) => setDebouncedSearch(value), SEARCH_DEBOUNCE_MS),
    [],
  );

  useEffect(() => {
    debouncedSetSearch(searchInput);
  }, [debouncedSetSearch, searchInput]);

  useEffect(() => () => debouncedSetSearch.cancel(), [debouncedSetSearch]);
  const effectiveSearch = largeGraphMode ? debouncedSearch : searchInput;

  const shouldProgressiveLayout = flowNodes.length > PROGRESSIVE_LAYOUT_NODE_LIMIT;

  const { nodes: layoutNodes, edges: layoutEdges } = useMemo(() => {
    perf.mark('layout');
    const progressive = shouldProgressiveLayout;
    const laidOut = applyDagreLayout(flowNodes, flowEdges, layoutDirection, { progressive });
    perf.measure('layout', 'layout_ms', {
      nodes: flowNodes.length,
      edges: flowEdges.length,
      direction: layoutDirection,
      progressive,
    });
    return laidOut;
  }, [flowEdges, flowNodes, layoutDirection, perf, shouldProgressiveLayout]);
  const [nodes, setNodes, onNodesChange] = useNodesState(layoutNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(layoutEdges);

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

  const relayout = useCallback(() => {
    const next = applyDagreLayout(flowNodes, flowEdges, layoutDirection, {
      progressive: false,
      previousPositions: nodePositionsRef.current,
    });
    nodePositionsRef.current = new Map(next.nodes.map((n) => [n.id, n.position]));
    setNodes(next.nodes);
    setEdges(next.edges);
    requestAnimationFrame(() => {
      flowInstanceRef.current?.fitView({ padding: 0.2 });
    });
  }, [flowEdges, flowNodes, layoutDirection, setEdges, setNodes]);

  useEffect(() => {
    setNodes(layoutNodes);
    setEdges(layoutEdges);
    nodePositionsRef.current = new Map(layoutNodes.map((n) => [n.id, n.position]));
    const progressive = shouldProgressiveLayout;
    if (!progressive) return;
    const refineId = window.setTimeout(() => {
      const refined = applyDagreLayout(flowNodes, flowEdges, layoutDirection, {
        progressive: false,
        previousPositions: nodePositionsRef.current,
      });
      nodePositionsRef.current = new Map(refined.nodes.map((n) => [n.id, n.position]));
      setNodes(refined.nodes);
      setEdges(refined.edges);
    }, 0);
    return () => window.clearTimeout(refineId);
  }, [flowEdges, flowNodes, layoutDirection, layoutEdges, layoutNodes, setEdges, setNodes, shouldProgressiveLayout]);

  useEffect(() => {
    setStoredValue(STORAGE_KEYS.theme, theme);
  }, [theme]);

  useEffect(() => {
    setStoredValue(STORAGE_KEYS.showCallReturns, String(showCallReturns));
  }, [showCallReturns]);

  useEffect(() => {
    setStoredValue(STORAGE_KEYS.edgeSequence, String(visibleEdgeKinds.sequence));
    setStoredValue(STORAGE_KEYS.edgeJump, String(visibleEdgeKinds.jump));
    setStoredValue(STORAGE_KEYS.edgeCall, String(visibleEdgeKinds.call));
    setStoredValue(STORAGE_KEYS.edgeCallReturn, String(visibleEdgeKinds.call_return));
  }, [visibleEdgeKinds]);

  const collapsedLabelChildren = useMemo(
    () => deriveCollapsedLabelChildren(flowNodes, collapsedParentLabels),
    [collapsedParentLabels, flowNodes],
  );

  const setAllVisibleSubgraphLabelsCollapsed = useCallback(
    (collapsed: boolean) => {
      setCollapsedParentLabels((prev) => {
        const next = { ...prev };
        visibleSubgraphLabels.forEach((label) => {
          next[label] = collapsed;
        });
        return next;
      });
    },
    [visibleSubgraphLabels],
  );

  const dialogueSearchCandidateNodeIds = useMemo(() => {
    const ids: string[] = [];
    for (const node of nodes) {
      const nodeData = node.data as { chapter?: string; dialogueCount?: number } | undefined;
      const chapterCollapsed = nodeData?.chapter ? collapsedChapters[nodeData.chapter] : false;
      const labelCollapsed = collapsedLabelChildren.has(node.id);
      const dialogueCount = nodeData?.dialogueCount ?? 0;
      if (chapterCollapsed || labelCollapsed) continue;
      if (dialogueCount < minDialogue) continue;
      ids.push(node.id);
    }
    return ids;
  }, [collapsedChapters, collapsedLabelChildren, minDialogue, nodes]);

  useEffect(() => {
    if (!largeGraphMode) return;
    const query = effectiveSearch.trim();
    if (!dialogueLineSearchEnabled || !query) {
      searchAbortControllerRef.current?.abort();
      searchAbortControllerRef.current = null;
      setDialogueSearchResults([]);
      return;
    }
    searchAbortControllerRef.current?.abort();
    const controller = new AbortController();
    searchAbortControllerRef.current = controller;
    void parseService
      .searchDialogueLines({
        query,
        nodeIds: dialogueSearchCandidateNodeIds,
        maxResults: largeGraphMode ? 500 : 2000,
        signal: controller.signal,
      })
      .then((results) => {
        if (controller.signal.aborted) return;
        setDialogueSearchResults(results);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setDialogueSearchResults([]);
      });
    return () => controller.abort();
  }, [
    dialogueLineSearchEnabled,
    dialogueSearchCandidateNodeIds,
    effectiveSearch,
    largeGraphMode,
    parseService,
  ]);

  const localDialogueSearchResults = useMemo<DialogueSearchResult[]>(() => {
    if (!dialogueLineSearchEnabled) return [];
    const query = effectiveSearch.trim();
    if (!query) return [];
    const searchableDocs: DialogueSearchDocument[] = [];
    for (const node of nodes) {
      const nodeData = node.data as { label: string; chapter?: string; dialogueCount?: number; dialogueLines?: string[] };
      const chapterCollapsed = nodeData.chapter ? collapsedChapters[nodeData.chapter] : false;
      const labelCollapsed = collapsedLabelChildren.has(node.id);
      if (chapterCollapsed || labelCollapsed) continue;
      if ((nodeData.dialogueCount ?? 0) < minDialogue) continue;
      const lines = nodeData.dialogueLines ?? [];
      lines.forEach((line, idx) => {
        searchableDocs.push({
          nodeId: node.id,
          nodeLabel: nodeData.label,
          lineIndex: idx + 1,
          lineText: line,
        });
      });
    }
    if (searchableDocs.length === 0) return [];
    const localDialogueFuse = new Fuse(searchableDocs, DIALOGUE_FUSE_OPTIONS);
    return localDialogueFuse.search(query, { limit: 2000 }).map((entry) => ({
      nodeId: entry.item.nodeId,
      nodeLabel: entry.item.nodeLabel,
      lineIndex: entry.item.lineIndex,
      lineText: entry.item.lineText,
    }));
  }, [collapsedChapters, collapsedLabelChildren, dialogueLineSearchEnabled, effectiveSearch, minDialogue, nodes]);

  const activeDialogueSearchResults = largeGraphMode ? dialogueSearchResults : localDialogueSearchResults;
  const dialogueMatchNodeIds = useMemo(
    () => new Set(activeDialogueSearchResults.map((result) => result.nodeId)),
    [activeDialogueSearchResults],
  );
  const nodeSearchMatchIds = useMemo(() => {
    const query = effectiveSearch.trim();
    if (!query) return null;
    const nodeSearchDocs: NodeSearchDocument[] = nodes.map((node) => {
      const nodeData = node.data as { label?: string; dialogueCount?: number };
      return {
        nodeId: node.id,
        label: nodeData.label ?? '',
        dialogueCountText: String(nodeData.dialogueCount ?? 0),
      };
    });
    const nodeFuse = new Fuse(nodeSearchDocs, NODE_FUSE_OPTIONS);
    return new Set(nodeFuse.search(query).map((entry) => entry.item.nodeId));
  }, [effectiveSearch, nodes]);
  const searchMatchNodeIds = useMemo(() => {
    if (!nodeSearchMatchIds) return null;
    const combined = new Set(nodeSearchMatchIds);
    dialogueMatchNodeIds.forEach((nodeId) => combined.add(nodeId));
    return combined;
  }, [dialogueMatchNodeIds, nodeSearchMatchIds]);

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
        previousById: previousVisibleNodesById,
      }),
    [
      collapsedChapters,
      collapsedLabelChildren,
      dialogueMatchNodeIds,
      dialogueLineSearchEnabled,
      effectiveSearch,
      minDialogue,
      nodes,
      previousVisibleNodesById,
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
        previousById: previousVisibleEdgesById,
      }),
    [edges, largeGraphMode, previousVisibleEdgesById, showCallReturns, theme, visibleEdgeKinds, visibleNodeIds],
  );

  useEffect(() => {
    setPreviousVisibleNodesById((previous) => {
      if (
        previous.size === visibleNodes.length &&
        visibleNodes.every((node) => previous.get(node.id) === node)
      ) {
        return previous;
      }
      return new Map(visibleNodes.map((node) => [node.id, node]));
    });
  }, [visibleNodes]);

  useEffect(() => {
    setPreviousVisibleEdgesById((previous) => {
      if (
        previous.size === visibleEdges.length &&
        visibleEdges.every((edge) => previous.get(edge.id) === edge)
      ) {
        return previous;
      }
      return new Map(visibleEdges.map((edge) => [edge.id, edge]));
    });
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
  }, [focusVisibleNode, visibleNodes]);

  const onSearchInputKeyDown = useCallback((event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (activeDialogueSearchResults.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveDialogueResultIndex((prev) => {
        const base = prev < 0 ? 0 : prev;
        return (base + 1 + activeDialogueSearchResults.length) % activeDialogueSearchResults.length;
      });
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveDialogueResultIndex((prev) => {
        const base = prev < 0 ? 0 : prev;
        return (base - 1 + activeDialogueSearchResults.length) % activeDialogueSearchResults.length;
      });
      return;
    }
    if (event.key === 'Enter') {
      if (resolvedActiveDialogueResultIndex < 0) return;
      event.preventDefault();
      const selected = activeDialogueSearchResults[resolvedActiveDialogueResultIndex];
      setActiveDialogueResultIndex(resolvedActiveDialogueResultIndex);
      onSelectDialogueSearchResult(selected);
    }
  }, [activeDialogueSearchResults, onSelectDialogueSearchResult, resolvedActiveDialogueResultIndex]);

  const onExportJson = useCallback(() => {
    const graphJson = JSON.stringify({ nodes: flowNodes, edges: flowEdges }, null, 2);
    const blob = new Blob([graphJson], { type: 'application/json' });
    saveAs(blob, 'renpy-flowchart.json');
  }, [flowEdges, flowNodes]);
  const onFitView = useCallback(() => {
    flowInstanceRef.current?.fitView({ padding: 0.2 });
  }, []);

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

  const focusTargetNode = useMemo(
    () => visibleNodes.find((n) => n.id === focusNodeId && !n.hidden),
    [focusNodeId, visibleNodes],
  );
  const inspectorDialogueLines = useMemo(
    () =>
      showAllInspectorLines
        ? selectedNodeData?.dialogueLines ?? []
        : (selectedNodeData?.dialogueLines ?? []).slice(0, INSPECTOR_DIALOGUE_TRUNCATE_DEFAULT),
    [selectedNodeData?.dialogueLines, showAllInspectorLines],
  );
  const shouldVirtualizeInspectorResults = activeDialogueSearchResults.length > 120;
  const shouldVirtualizeInspectorLines = inspectorDialogueLines.length > 120;
  /* eslint-disable react-hooks/incompatible-library */
  const dialogueResultsVirtualizer = useVirtualizer({
    count: shouldVirtualizeInspectorResults ? activeDialogueSearchResults.length : 0,
    getScrollElement: () => dialogueResultsScrollRef.current,
    estimateSize: () => 52,
    overscan: 6,
  });
  const inspectorLinesVirtualizer = useVirtualizer({
    count: shouldVirtualizeInspectorLines ? inspectorDialogueLines.length : 0,
    getScrollElement: () => inspectorLinesScrollRef.current,
    estimateSize: () => 34,
    overscan: 10,
  });
  /* eslint-enable react-hooks/incompatible-library */

  return (
    <div className="flex flex-col h-full min-h-0" style={{ backgroundColor: THEMES[theme].pageBg, color: THEMES[theme].text }}>
      {/* Toolbar */}
      <div className="px-3 sm:px-4 py-3 border-b border-gray-200 bg-white shrink-0" role="toolbar" aria-label="Viewer controls">
        <div className="flex flex-col gap-3">
          <div className="text-sm" style={{ color: THEMES[theme].subtleText }} aria-live="off">
            {visibleNodeIds.size} / {flowNodes.length} node{flowNodes.length !== 1 ? 's' : ''} ·{' '}
            {visibleEdges.length} / {flowEdges.length} edge{flowEdges.length !== 1 ? 's' : ''}
          </div>
          <div className="flex flex-wrap items-start gap-2 md:gap-3" role="group" aria-label="Primary controls">
            <div className="flex flex-wrap items-center gap-2 grow" role="group" aria-label="Search and filters">
              <label htmlFor="viewer-search-input" className="text-xs font-medium text-gray-700">Search</label>
              <div className="relative flex items-center min-w-[12rem] grow sm:grow-0">
                <Search size={14} className="absolute left-2 text-gray-400" aria-hidden="true" />
                <input
                  id="viewer-search-input"
                  ref={searchInputRef}
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  onKeyDown={onSearchInputKeyDown}
                  placeholder="Search labels, dialogue lines, or dialogue count"
                  aria-describedby="viewer-search-help"
                  className={`pl-7 pr-2 w-full sm:w-[16rem] max-w-[90vw] ${CONTROL_INPUT_CLASS}`}
                />
              </div>
              <span id="viewer-search-help" className="sr-only">
                {dialogueLineSearchEnabled
                  ? 'Search labels, dialogue lines, or dialogue count.'
                  : 'Search labels or dialogue count.'}
              </span>
              <label className="text-xs flex items-center gap-1" htmlFor="min-dialogue-input">
                Minimum dialogue lines
                <input
                  id="min-dialogue-input"
                  type="number"
                  min={0}
                  value={minDialogue}
                  onChange={(e) => setMinDialogue(Number(e.target.value) || 0)}
                  aria-label="Minimum dialogue lines"
                  className={`w-16 ${CONTROL_INPUT_CLASS}`}
                />
              </label>
              <label className="text-xs flex items-center gap-1" htmlFor="dialogue-search-mode-input">
                Dialogue search mode
                <select
                  id="dialogue-search-mode-input"
                  value={selectedDialogueSearchMode}
                  onChange={(e) => {
                    const mode = e.target.value as DialogueSearchMode;
                    if (onDialogueSearchModeChange) {
                      onDialogueSearchModeChange(mode);
                      return;
                    }
                    setStandaloneDialogueSearchMode(mode);
                  }}
                  aria-label="Dialogue search mode"
                  className={CONTROL_INPUT_CLASS}
                >
                  <option value="auto">Auto (faster on large imports)</option>
                  <option value="full">Full dialogue line search</option>
                  <option value="countOnly">Performance mode (label/count only)</option>
                </select>
              </label>
              {!dialogueLineSearchEnabled && (
                <span className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                  Dialogue line search is disabled in performance mode.
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={onFitView}
              className={CONTROL_BUTTON_CLASS}
              aria-label="Fit graph to view"
            >
              Fit view
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Export controls">
            {isLargeExportTarget && (
              <span className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                Large graph export: PNG quality reduced for responsiveness
              </span>
            )}
            <button
              onClick={onExport}
              aria-label="Export flowchart as PNG"
              className={`${PRIMARY_BUTTON_CLASS} text-white bg-violet-600 hover:bg-violet-700`}
            >
              <Download size={14} aria-hidden="true" />
              Export PNG
            </button>
            <button
              onClick={onExportSvg}
              aria-label="Export flowchart as SVG"
              className={`${PRIMARY_BUTTON_CLASS} text-violet-700 border border-violet-300 bg-white hover:bg-violet-50`}
            >
              <Download size={14} aria-hidden="true" />
              Export SVG
            </button>
            <button
              onClick={onExportJson}
              aria-label="Export graph as JSON"
              className={`${PRIMARY_BUTTON_CLASS} text-gray-700 border border-gray-300 bg-white hover:bg-gray-50`}
            >
              <Download size={14} aria-hidden="true" />
              Export JSON
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {ZOOM_PRESETS.map((preset) => (
              <button
                key={preset}
                onClick={() => flowInstanceRef.current?.zoomTo(preset, { duration: 250 })}
                className={CONTROL_BUTTON_CLASS}
                aria-label={`Zoom to ${Math.round(preset * 100)} percent`}
              >
                <ZoomIn size={12} className="inline mr-1" aria-hidden="true" />
                {Math.round(preset * 100)}%
              </button>
            ))}
            <span className="text-[11px] text-gray-500">
              Shortcuts: Ctrl/Cmd+F search · Ctrl/Cmd+L fit · Ctrl/Cmd+E export PNG
            </span>
            <button
              type="button"
              onClick={() => setShowAdvancedControls((prev) => !prev)}
              className={CONTROL_BUTTON_CLASS}
              aria-expanded={showAdvancedControls}
              aria-controls="viewer-advanced-controls"
              aria-label={showAdvancedControls ? 'Hide advanced controls' : 'Show advanced controls'}
            >
              {showAdvancedControls ? 'Hide advanced controls' : 'Show advanced controls'}
            </button>
          </div>
          {showAdvancedControls && (
            <div id="viewer-advanced-controls" className="border border-gray-200 rounded-lg p-3 flex flex-col gap-3" role="group" aria-label="Advanced controls">
              <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Layout and focus controls">
                <label className="text-xs flex items-center gap-1">
                  <LayoutGrid size={14} aria-hidden="true" />
                  Layout
                  <select
                    value={layoutDirection}
                    onChange={(e) => setLayoutDirection(e.target.value as LayoutDirection)}
                    aria-label="Auto layout direction"
                    className={CONTROL_INPUT_CLASS}
                  >
                    <option value="TB">Top to bottom</option>
                    <option value="LR">Left to right</option>
                  </select>
                </label>
                <button
                  onClick={relayout}
                  className={CONTROL_BUTTON_CLASS}
                  aria-label="Re-run auto layout"
                >
                  Auto-layout
                </button>
                <label className="text-xs flex items-center gap-1 flex-wrap">
                  <Palette size={14} aria-hidden="true" />
                  Theme
                  <select
                    value={theme}
                    onChange={(e) => setTheme(e.target.value as ThemeName)}
                    aria-label="Color theme"
                    className={CONTROL_INPUT_CLASS}
                  >
                    <option value="violet">Default</option>
                    <option value="highContrast">High contrast</option>
                    <option value="colorblind">Colorblind-safe</option>
                  </select>
                </label>

                <label className="text-xs flex items-center gap-1 flex-wrap">
                  Focus label
                  <select
                    value={focusNodeId}
                    onChange={(e) => setFocusNodeId(e.target.value)}
                    aria-label="Focus label"
                    className={CONTROL_INPUT_CLASS}
                  >
                    <option value="">Select label</option>
                    {labels.map((label) => (
                      <option key={label} value={label}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  onClick={onFocusSelectedNode}
                  disabled={!focusNodeId}
                  className={CONTROL_BUTTON_CLASS}
                  aria-label="Center selected label"
                >
                  <LocateFixed size={12} className="inline mr-1" aria-hidden="true" />
                  Center
                </button>
                <span className="text-[11px] text-gray-600" aria-live="off">
                  {!focusNodeId
                    ? 'Select a label, then center it in view.'
                    : focusTargetNode
                      ? `Ready to center: ${focusNodeId}`
                      : `${focusNodeId} is hidden by current filters.`}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-xs" role="group" aria-label="Advanced graph filters">
                <label className="inline-flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={showCallReturns}
                    onChange={(e) => setShowCallReturns(e.target.checked)}
                    aria-label="Show call returns"
                  />
                  Show call returns
                </label>
                <label className="inline-flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={largeGraphMode}
                    onChange={(e) => setLargeGraphModeOverride(e.target.checked)}
                    aria-label="Enable large graph mode"
                  />
                  Large graph mode
                </label>
                {largeGraphModeOverride !== null && (
                  <button
                    type="button"
                    className={CONTROL_BUTTON_CLASS}
                    onClick={() => setLargeGraphModeOverride(null)}
                    aria-label="Use automatic large graph mode"
                  >
                    Use auto
                  </button>
                )}
                <span className="text-[11px] text-gray-600" role="status" aria-live="polite">
                  {largeGraphModeStatusText}
                </span>
                <div className="flex flex-wrap items-center gap-1 text-xs">
                  <span>Edges</span>
                  {(['sequence', 'jump', 'call', 'call_return'] as const).map((kind) => (
                    <label key={kind} className="inline-flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={visibleEdgeKinds[kind]}
                        onChange={(e) =>
                          setVisibleEdgeKinds((prev) => ({ ...prev, [kind]: e.target.checked }))
                        }
                        aria-label={`Show ${kind.replace('_', ' ')} edges`}
                      />
                      {kind.replace('_', ' ')}
                    </label>
                  ))}
                </div>
              </div>
              <div className="border-t border-gray-200 pt-3 flex flex-col gap-3" role="group" aria-label="Chapter and label subgraph filters">
                {chapters.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-xs">Chapter subgraphs:</span>
                    {chapters.map((chapter) => (
                      <button
                        key={chapter}
                        onClick={() =>
                          setCollapsedChapters((prev) => ({ ...prev, [chapter]: !prev[chapter] }))
                        }
                        className={CONTROL_BUTTON_CLASS}
                        aria-label={`${collapsedChapters[chapter] ? 'Expand' : 'Collapse'} chapter ${chapter}`}
                      >
                        {collapsedChapters[chapter] ? '▸' : '▾'} {chapter}
                      </button>
                    ))}
                  </div>
                )}
                {labels.length > 0 && (
                  <div className="flex flex-col gap-2 min-w-[18rem]" role="group" aria-label="Label subgraphs">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-xs">Label subgraphs:</span>
                      <span className="text-[11px] text-gray-600" aria-live="polite">
                        {collapsedLabelCount} collapsed
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <label htmlFor="label-subgraph-filter" className="sr-only">
                        Filter label subgraphs
                      </label>
                      <input
                        id="label-subgraph-filter"
                        type="search"
                        value={labelSubgraphSearchInput}
                        onChange={(e) => setLabelSubgraphSearchInput(e.target.value)}
                        placeholder="Filter labels"
                        aria-label="Filter label subgraphs"
                        className={CONTROL_INPUT_CLASS}
                      />
                      <button
                        type="button"
                        onClick={() => setAllVisibleSubgraphLabelsCollapsed(true)}
                        disabled={visibleSubgraphLabels.length === 0}
                        className={CONTROL_BUTTON_CLASS}
                        aria-label="Collapse all visible label subgraphs"
                      >
                        Collapse all
                      </button>
                      <button
                        type="button"
                        onClick={() => setAllVisibleSubgraphLabelsCollapsed(false)}
                        disabled={visibleSubgraphLabels.length === 0}
                        className={CONTROL_BUTTON_CLASS}
                        aria-label="Expand all visible label subgraphs"
                      >
                        Expand all
                      </button>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {visibleSubgraphLabels.length === 0 ? (
                        <span className="text-[11px] text-gray-500">No labels match the filter.</span>
                      ) : (
                        <>
                          {visibleLabelSubgraphToggles.map((label) => (
                            <button
                              key={label}
                              onClick={() =>
                                setCollapsedParentLabels((prev) => ({ ...prev, [label]: !prev[label] }))
                              }
                              className={CONTROL_BUTTON_CLASS}
                              aria-label={`${collapsedParentLabels[label] ? 'Expand' : 'Collapse'} label ${label}`}
                            >
                              {collapsedParentLabels[label] ? '▸' : '▾'} {label}
                            </button>
                          ))}
                          {visibleSubgraphLabels.length > MAX_VISIBLE_LABEL_SUBGRAPH_TOGGLES && (
                            <button
                              type="button"
                              onClick={() => setShowAllLabelSubgraphToggles((prev) => !prev)}
                              className={CONTROL_BUTTON_CLASS}
                              aria-label={
                                shouldShowAllLabelSubgraphToggles
                                  ? 'Show fewer label subgraph toggles'
                                  : `Show ${Math.max(visibleSubgraphLabels.length - MAX_VISIBLE_LABEL_SUBGRAPH_TOGGLES, 0)} more label subgraph toggles`
                              }
                            >
                              {shouldShowAllLabelSubgraphToggles
                                ? 'Show fewer'
                                : `Show ${Math.max(visibleSubgraphLabels.length - MAX_VISIBLE_LABEL_SUBGRAPH_TOGGLES, 0)} more`}
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

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
        <aside
          className="w-full xl:w-96 xl:max-w-[40%] xl:min-w-[280px] border-t xl:border-t-0 xl:border-l border-gray-200 bg-white p-3 overflow-y-auto max-h-[45vh] xl:max-h-none"
          aria-label="Inspector panel"
        >
          <div className="text-sm font-semibold mb-2">Inspector</div>
          {effectiveSearch.trim().length > 0 && (
            <div className="mb-4">
              <div className="text-xs text-gray-700 mb-1" role="status" aria-live="polite">
                Node matches (label/count): {nodeSearchMatchCount}
              </div>
              {!dialogueLineSearchEnabled ? (
                <div className="text-xs text-gray-600" role="status" aria-live="polite">
                  Dialogue line matching is unavailable in performance mode.
                </div>
              ) : (
                <>
               <div className="text-xs font-semibold text-gray-700 mb-1">
                 Dialogue line matches ({activeDialogueSearchResults.length})
               </div>
               <div
                 ref={dialogueResultsScrollRef}
                 className="max-h-48 overflow-y-auto"
                 aria-label="Dialogue search results"
               >
                 {activeDialogueSearchResults.length === 0 ? (
                   <div className="text-xs text-gray-500">
                     <div role="status" aria-live="polite">
                       No dialogue lines matched “{effectiveSearch.trim()}”. Label or dialogue-count matches may still appear elsewhere.
                     </div>
                   </div>
                 ) : shouldVirtualizeInspectorResults ? (
                   <ul
                     className="relative space-y-1"
                     style={{ height: `${dialogueResultsVirtualizer.getTotalSize()}px` }}
                   >
                     {dialogueResultsVirtualizer.getVirtualItems().map((virtualItem) => {
                       const result = activeDialogueSearchResults[virtualItem.index];
                       return (
                         <li
                           key={`${result.nodeId}-${result.lineIndex}`}
                           className="absolute left-0 top-0 w-full"
                           style={{ transform: `translateY(${virtualItem.start}px)` }}
                         >
                           <button
                             type="button"
                             aria-current={virtualItem.index === resolvedActiveDialogueResultIndex ? 'true' : undefined}
                             aria-label={`${result.nodeLabel} line ${result.lineIndex}: ${truncateForAria(result.lineText)}`}
                             onClick={() => {
                               setActiveDialogueResultIndex(virtualItem.index);
                               onSelectDialogueSearchResult(result);
                             }}
                             className={`w-full text-left border rounded px-2 py-1 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 ${
                               virtualItem.index === resolvedActiveDialogueResultIndex
                                 ? 'border-violet-400 bg-violet-50'
                                 : 'border-gray-200'
                             }`}
                           >
                             <div className="text-xs font-medium">{result.nodeLabel} · line {result.lineIndex}</div>
                             <div className="text-xs text-gray-600 truncate">{renderHighlightedText(result.lineText, effectiveSearch)}</div>
                           </button>
                         </li>
                       );
                     })}
                   </ul>
                 ) : (
                   <ul className="space-y-1">
                     {activeDialogueSearchResults.map((result, resultIndex) => (
                       <li key={`${result.nodeId}-${result.lineIndex}`}>
                         <button
                           type="button"
                           aria-current={resultIndex === resolvedActiveDialogueResultIndex ? 'true' : undefined}
                           aria-label={`${result.nodeLabel} line ${result.lineIndex}: ${truncateForAria(result.lineText)}`}
                           onClick={() => {
                             setActiveDialogueResultIndex(resultIndex);
                             onSelectDialogueSearchResult(result);
                           }}
                           className={`w-full text-left border rounded px-2 py-1 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 ${
                             resultIndex === resolvedActiveDialogueResultIndex
                               ? 'border-violet-400 bg-violet-50'
                               : 'border-gray-200'
                           }`}
                         >
                           <div className="text-xs font-medium">{result.nodeLabel} · line {result.lineIndex}</div>
                           <div className="text-xs text-gray-600 truncate">{renderHighlightedText(result.lineText, effectiveSearch)}</div>
                         </button>
                       </li>
                     ))}
                   </ul>
                 )}
               </div>
                {activeDialogueSearchResults.length > 0 && (
                  <div className="mt-1 text-[11px] text-gray-500" role="status" aria-live="polite">
                    Tip: with search focused, use ↑/↓ to move results and Enter to open.
                  </div>
                )}
                </>
              )}
            </div>
          )}
          {!selectedNode || !selectedNodeData ? (
            <div className="text-xs text-gray-500">
              {effectiveSearch.trim().length > 0
                ? 'Choose a search result or click a visible node to inspect dialogue lines.'
                : 'Select a node to inspect dialogue lines, or search to jump to matching dialogue.'}
            </div>
          ) : (
            <div className="space-y-2">
              <div className="text-xs">
                <span className="font-semibold">Node:</span> {selectedNodeData.label}
              </div>
              <div className="text-xs">
                <span className="font-semibold">Dialogue lines:</span> {selectedNodeData.dialogueCount ?? 0}
              </div>
              <div className="text-xs font-semibold">Dialogue</div>
              <div ref={inspectorLinesScrollRef} className={shouldVirtualizeInspectorLines ? 'max-h-64 overflow-y-auto' : ''}>
                <div
                  className="space-y-1"
                  style={shouldVirtualizeInspectorLines ? { height: `${inspectorLinesVirtualizer.getTotalSize()}px`, position: 'relative' } : undefined}
                >
                  {(shouldVirtualizeInspectorLines
                    ? inspectorLinesVirtualizer.getVirtualItems().map((virtualItem) => ({
                        key: virtualItem.index,
                        index: virtualItem.index,
                        start: virtualItem.start,
                      }))
                    : inspectorDialogueLines.map((_, idx) => ({ key: idx, index: idx, start: 0 }))
                  ).map((item) => {
                    const line = inspectorDialogueLines[item.index] ?? '';
                    const absoluteIndex = item.index + 1;
                    const isSelectedLine = selectedDialogueLineIndex === absoluteIndex;
                    return (
                      <div
                        key={`${selectedNodeId}-${item.key}`}
                        className={`text-xs border rounded px-2 py-1 ${isSelectedLine ? 'border-violet-400 bg-violet-50' : 'border-gray-200'}`}
                        style={shouldVirtualizeInspectorLines ? { position: 'absolute', left: 0, top: 0, width: '100%', transform: `translateY(${item.start}px)` } : undefined}
                      >
                        <span className="font-medium mr-1">{absoluteIndex}.</span>
                        {renderHighlightedText(line, effectiveSearch)}
                      </div>
                    );
                  })}
                </div>
              </div>
              {(selectedNodeData.dialogueLines?.length ?? 0) > INSPECTOR_DIALOGUE_TRUNCATE_DEFAULT && (
                <button
                  type="button"
                  onClick={() => setShowAllInspectorLines((prev) => !prev)}
                  className="text-xs text-violet-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 rounded"
                >
                  {showAllInspectorLines ? 'Show less' : `Show more (${(selectedNodeData.dialogueLines?.length ?? 0) - INSPECTOR_DIALOGUE_TRUNCATE_DEFAULT} more)`}
                </button>
              )}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
