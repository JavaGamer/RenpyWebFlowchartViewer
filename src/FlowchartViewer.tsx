/**
 * src/FlowchartViewer.tsx
 *
 * Renders the parsed Ren'Py flowchart using React Flow + dagre.
 * Exports a high-resolution PNG via html-to-image.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
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
import { toBlob, toSvg } from 'html-to-image';
import { Download, Search, ZoomIn, LayoutGrid, Palette, LocateFixed } from 'lucide-react';
import { STORAGE_KEYS } from './config/storageKeys';
import {
  LARGE_EXPORT_GRAPH_ELEMENTS_THRESHOLD,
  INSPECTOR_DIALOGUE_TRUNCATE_DEFAULT,
  LARGE_GRAPH_EDGE_THRESHOLD,
  LARGE_GRAPH_NODE_THRESHOLD,
  SEARCH_DEBOUNCE_MS,
  ZOOM_PRESETS,
} from './config/viewerConfig';
import type { ThemeName, LayoutDirection } from './ui/viewerTypes';
import {
  type CanvasNode,
  type CanvasEdge,
  type EdgeKindFilter,
  applyDagreLayout,
  buildVisibleEdges,
  buildVisibleNodes,
  getNodeCenter,
} from './flowchartTransforms';
import { createPerfTracker } from './perf';
import { THEMES } from './ui/viewerTheme';
import { nodeTypes, edgeTypes } from './ui/viewerReactFlowRegistry';
import type { FlowchartViewerProps } from './ui/viewerTypesInternal';
import { type DialogueSearchResult } from './ui/viewerText';
import { ViewerInspector } from './ui/viewerInspector';

// ─── Main component ───────────────────────────────────────────────────────────

export default function FlowchartViewer({
  flowNodes,
  flowEdges,
}: FlowchartViewerProps) {
  const perf = useMemo(() => createPerfTracker('viewer'), []);
  const flowRef = useRef<HTMLDivElement>(null);
  const flowInstanceRef = useRef<ReactFlowInstance<CanvasNode, CanvasEdge> | null>(null);
  const [layoutDirection, setLayoutDirection] = useState<LayoutDirection>('TB');
  const [searchInput, setSearchInput] = useState('');
  const [minDialogue, setMinDialogue] = useState(0);
  const [theme, setTheme] = useState<ThemeName>(() => {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEYS.theme);
    if (raw === 'violet' || raw === 'highContrast' || raw === 'colorblind') return raw;
    return 'violet';
  });
  const [collapsedChapters, setCollapsedChapters] = useState<Record<string, boolean>>({});
  const [collapsedParentLabels, setCollapsedParentLabels] = useState<Record<string, boolean>>({});
  const [showCallReturns, setShowCallReturns] = useState(
    () => globalThis.localStorage?.getItem(STORAGE_KEYS.showCallReturns) === 'true',
  );
  const [visibleEdgeKinds, setVisibleEdgeKinds] = useState<Record<EdgeKindFilter, boolean>>(() => ({
    sequence: globalThis.localStorage?.getItem(STORAGE_KEYS.edgeSequence) !== 'false',
    jump: globalThis.localStorage?.getItem(STORAGE_KEYS.edgeJump) !== 'false',
    call: globalThis.localStorage?.getItem(STORAGE_KEYS.edgeCall) !== 'false',
    call_return: globalThis.localStorage?.getItem(STORAGE_KEYS.edgeCallReturn) !== 'false',
  }));
  const [focusNodeId, setFocusNodeId] = useState<string>('');
  const [largeGraphModeOverride, setLargeGraphModeOverride] = useState<boolean | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string>('');
  const [selectedDialogueLineIndex, setSelectedDialogueLineIndex] = useState<number | null>(null);
  const [showAllInspectorLines, setShowAllInspectorLines] = useState(false);
  const [activeDialogueResultIndex, setActiveDialogueResultIndex] = useState(-1);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const autoLargeGraphMode = useMemo(
    () => flowNodes.length > LARGE_GRAPH_NODE_THRESHOLD || flowEdges.length > LARGE_GRAPH_EDGE_THRESHOLD,
    [flowEdges.length, flowNodes.length],
  );
  const largeGraphMode = largeGraphModeOverride ?? autoLargeGraphMode;
  const [debouncedSearch, setDebouncedSearch] = useState(searchInput);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedSearch(searchInput);
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timeout);
  }, [searchInput]);
  const effectiveSearch = largeGraphMode ? debouncedSearch : searchInput;

  const { nodes: layoutNodes, edges: layoutEdges } = useMemo(() => {
    perf.mark('layout');
    const laidOut = applyDagreLayout(flowNodes, flowEdges, layoutDirection);
    perf.measure('layout', 'layout_ms', {
      nodes: flowNodes.length,
      edges: flowEdges.length,
      direction: layoutDirection,
    });
    return laidOut;
  }, [flowNodes, flowEdges, layoutDirection, perf]);
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

  const relayout = useCallback(() => {
    const next = applyDagreLayout(flowNodes, flowEdges, layoutDirection);
    setNodes(next.nodes);
    setEdges(next.edges);
    requestAnimationFrame(() => {
      flowInstanceRef.current?.fitView({ padding: 0.2 });
    });
  }, [flowEdges, flowNodes, layoutDirection, setEdges, setNodes]);

  useEffect(() => {
    setNodes(layoutNodes);
    setEdges(layoutEdges);
  }, [layoutNodes, layoutEdges, setEdges, setNodes]);

  useEffect(() => {
    globalThis.localStorage?.setItem(STORAGE_KEYS.theme, theme);
  }, [theme]);

  useEffect(() => {
    globalThis.localStorage?.setItem(STORAGE_KEYS.showCallReturns, String(showCallReturns));
  }, [showCallReturns]);

  useEffect(() => {
    globalThis.localStorage?.setItem(STORAGE_KEYS.edgeSequence, String(visibleEdgeKinds.sequence));
    globalThis.localStorage?.setItem(STORAGE_KEYS.edgeJump, String(visibleEdgeKinds.jump));
    globalThis.localStorage?.setItem(STORAGE_KEYS.edgeCall, String(visibleEdgeKinds.call));
    globalThis.localStorage?.setItem(STORAGE_KEYS.edgeCallReturn, String(visibleEdgeKinds.call_return));
  }, [visibleEdgeKinds]);

  const collapsedLabelChildren = useMemo(
    () =>
      new Set(
        flowNodes
          .filter(
            (n) => n.type === 'MENU' && n.parentLabelId && collapsedParentLabels[n.parentLabelId],
          )
          .map((n) => n.id),
      ),
    [collapsedParentLabels, flowNodes],
  );

  const visibleNodes = useMemo(
    () =>
      buildVisibleNodes({
        nodes,
        search: effectiveSearch,
        minDialogue,
        collapsedChapters,
        collapsedLabelChildren,
        theme,
      }),
    [collapsedChapters, collapsedLabelChildren, effectiveSearch, minDialogue, nodes, theme],
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
      }),
    [edges, largeGraphMode, showCallReturns, theme, visibleEdgeKinds, visibleNodeIds],
  );

  const selectedNode = useMemo(
    () => visibleNodes.find((n) => n.id === selectedNodeId && !n.hidden) ?? null,
    [selectedNodeId, visibleNodes],
  );

  const selectedNodeData = selectedNode?.data as { label?: string; dialogueCount?: number; dialogueLines?: string[] } | undefined;

  const dialogueSearchResults = useMemo<DialogueSearchResult[]>(() => {
    const query = effectiveSearch.trim().toLowerCase();
    if (!query) return [];
    const results: DialogueSearchResult[] = [];
    for (const node of visibleNodes) {
      if (node.hidden) continue;
      const data = node.data as { label: string; dialogueLines?: string[] };
      const lines = data.dialogueLines ?? [];
      lines.forEach((line, idx) => {
        if (line.toLowerCase().includes(query)) {
          results.push({
            nodeId: node.id,
            nodeLabel: data.label,
            lineIndex: idx + 1,
            lineText: line,
          });
        }
      });
    }
    return results;
  }, [effectiveSearch, visibleNodes]);

  const resolvedActiveDialogueResultIndex = useMemo(() => {
    if (dialogueSearchResults.length === 0) return -1;
    if (activeDialogueResultIndex < 0) return 0;
    if (activeDialogueResultIndex >= dialogueSearchResults.length) return dialogueSearchResults.length - 1;
    return activeDialogueResultIndex;
  }, [activeDialogueResultIndex, dialogueSearchResults.length]);

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
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.download = 'renpy-flowchart.png';
        a.href = url;
        a.click();
        URL.revokeObjectURL(url);
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
        const a = document.createElement('a');
        a.download = 'renpy-flowchart.svg';
        a.href = svgDataUrl;
        a.click();
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
    if (dialogueSearchResults.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveDialogueResultIndex((prev) => {
        const base = prev < 0 ? 0 : prev;
        return (base + 1 + dialogueSearchResults.length) % dialogueSearchResults.length;
      });
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveDialogueResultIndex((prev) => {
        const base = prev < 0 ? 0 : prev;
        return (base - 1 + dialogueSearchResults.length) % dialogueSearchResults.length;
      });
      return;
    }
    if (event.key === 'Enter') {
      if (resolvedActiveDialogueResultIndex < 0) return;
      event.preventDefault();
      const selected = dialogueSearchResults[resolvedActiveDialogueResultIndex];
      setActiveDialogueResultIndex(resolvedActiveDialogueResultIndex);
      onSelectDialogueSearchResult(selected);
    }
  }, [dialogueSearchResults, onSelectDialogueSearchResult, resolvedActiveDialogueResultIndex]);

  const onExportJson = useCallback(() => {
    const graphJson = JSON.stringify({ nodes: flowNodes, edges: flowEdges }, null, 2);
    const blob = new Blob([graphJson], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.download = 'renpy-flowchart.json';
    a.href = url;
    a.click();
    URL.revokeObjectURL(url);
  }, [flowEdges, flowNodes]);

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

  return (
    <div className="flex flex-col h-full min-h-0" style={{ backgroundColor: THEMES[theme].pageBg, color: THEMES[theme].text }}>
      {/* Toolbar */}
      <div className="px-3 sm:px-4 py-3 border-b border-gray-200 bg-white shrink-0" role="toolbar" aria-label="Viewer controls">
        <div className="flex flex-col gap-3">
          <div className="text-sm" style={{ color: THEMES[theme].subtleText }}>
            {visibleNodeIds.size} / {flowNodes.length} node{flowNodes.length !== 1 ? 's' : ''} ·{' '}
            {visibleEdges.length} / {flowEdges.length} edge{flowEdges.length !== 1 ? 's' : ''}
          </div>
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Search and filters">
            <label htmlFor="viewer-search-input" className="text-xs font-medium text-gray-700">Search</label>
            <div className="relative flex items-center min-w-[12rem]">
              <Search size={14} className="absolute left-2 text-gray-400" aria-hidden="true" />
              <input
                id="viewer-search-input"
                ref={searchInputRef}
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={onSearchInputKeyDown}
                placeholder="Search labels, dialogue lines, or dialogue count"
                aria-describedby="viewer-search-help"
                className="pl-7 pr-2 py-1.5 text-sm border border-gray-300 rounded-md w-[14rem] max-w-[80vw] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
              />
            </div>
            <span id="viewer-search-help" className="sr-only">
              Search labels, dialogue lines, or dialogue count.
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
               className="w-16 px-2 py-1.5 border border-gray-300 rounded-md text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
             />
           </label>
            <label className="text-xs flex items-center gap-1">
            <input
              type="checkbox"
              checked={showCallReturns}
              onChange={(e) => setShowCallReturns(e.target.checked)}
              aria-label="Show call returns"
            />
            Show call returns
             </label>
            <label className="text-xs flex items-center gap-1">
            <input
              type="checkbox"
              checked={largeGraphMode}
              onChange={(e) => setLargeGraphModeOverride(e.target.checked)}
              aria-label="Enable large graph mode"
            />
            Large graph mode
             </label>
          </div>
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Layout and focus controls">
            <label className="text-xs flex items-center gap-1">
             <LayoutGrid size={14} aria-hidden="true" />
             Layout
             <select
               value={layoutDirection}
               onChange={(e) => setLayoutDirection(e.target.value as LayoutDirection)}
               aria-label="Auto layout direction"
               className="px-2 py-1.5 border border-gray-300 rounded-md text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
             >
               <option value="TB">Top to bottom</option>
               <option value="LR">Left to right</option>
             </select>
           </label>
            <button
            onClick={relayout}
            className="px-2 py-1 text-xs border border-gray-300 rounded-md hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
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
               className="px-2 py-1.5 border border-gray-300 rounded-md text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
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
               className="px-2 py-1.5 border border-gray-300 rounded-md text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
             >
               <option value="">Select label</option>
               {labels.map((label) => (
                <option key={label} value={label}>
                  {label}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={onFocusSelectedNode}
              className="px-2 py-1 text-xs border border-gray-300 rounded-md hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
              aria-label="Center selected label"
            >
              <LocateFixed size={12} className="inline mr-1" aria-hidden="true" />
              Center
            </button>
          </label>
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

            {ZOOM_PRESETS.map((preset) => (
            <button
              key={preset}
              onClick={() => flowInstanceRef.current?.zoomTo(preset, { duration: 250 })}
              className="px-2 py-1 text-xs border border-gray-300 rounded-md hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
              aria-label={`Zoom to ${Math.round(preset * 100)} percent`}
            >
              <ZoomIn size={12} className="inline mr-1" aria-hidden="true" />
              {Math.round(preset * 100)}%
            </button>
          ))}
            <span className="text-[11px] text-gray-500">
              Shortcuts: Ctrl/Cmd+F search · Ctrl/Cmd+L fit · Ctrl/Cmd+E export PNG
            </span>
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
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-violet-600 hover:bg-violet-700 rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
            >
              <Download size={14} aria-hidden="true" />
              Export PNG
            </button>
            <button
              onClick={onExportSvg}
              aria-label="Export flowchart as SVG"
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-violet-700 border border-violet-300 bg-white hover:bg-violet-50 rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
            >
              <Download size={14} aria-hidden="true" />
              Export SVG
            </button>
            <button
              onClick={onExportJson}
              aria-label="Export graph as JSON"
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-700 border border-gray-300 bg-white hover:bg-gray-50 rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
            >
              <Download size={14} aria-hidden="true" />
              Export JSON
            </button>
          </div>
        </div>
      </div>

      <div className="shrink-0 border-b border-gray-200 px-3 sm:px-4 py-2 bg-white flex flex-wrap gap-4 text-xs" role="toolbar" aria-label="Chapter and label subgraph filters">
        {chapters.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="font-semibold">Chapter subgraphs:</span>
            {chapters.map((chapter) => (
                <button
                  key={chapter}
                  onClick={() =>
                    setCollapsedChapters((prev) => ({ ...prev, [chapter]: !prev[chapter] }))
                  }
                  className="px-2 py-1 border border-gray-300 rounded-md hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
                  aria-label={`${collapsedChapters[chapter] ? 'Expand' : 'Collapse'} chapter ${chapter}`}
                >
                  {collapsedChapters[chapter] ? '▸' : '▾'} {chapter}
                </button>
            ))}
          </div>
        )}
        {labels.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="font-semibold">Label subgraphs:</span>
            {labels.map((label) => (
                <button
                  key={label}
                  onClick={() =>
                    setCollapsedParentLabels((prev) => ({ ...prev, [label]: !prev[label] }))
                  }
                  className="px-2 py-1 border border-gray-300 rounded-md hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
                  aria-label={`${collapsedParentLabels[label] ? 'Expand' : 'Collapse'} label ${label}`}
                >
                  {collapsedParentLabels[label] ? '▸' : '▾'} {label}
                </button>
            ))}
          </div>
        )}
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
        <ViewerInspector
          effectiveSearch={effectiveSearch}
          dialogueSearchResults={dialogueSearchResults}
          resolvedActiveDialogueResultIndex={resolvedActiveDialogueResultIndex}
          selectedNode={selectedNode}
          selectedNodeData={selectedNodeData}
          selectedNodeId={selectedNodeId}
          selectedDialogueLineIndex={selectedDialogueLineIndex}
          showAllInspectorLines={showAllInspectorLines}
          onToggleShowAllInspectorLines={() => setShowAllInspectorLines((prev) => !prev)}
          onSetActiveDialogueResultIndex={setActiveDialogueResultIndex}
          onSelectDialogueSearchResult={onSelectDialogueSearchResult}
        />
      </div>
    </div>
  );
}
