/**
 * src/FlowchartViewer.tsx
 *
 * Renders the parsed Ren'Py flowchart using React Flow + dagre.
 * Exports a high-resolution PNG via html-to-image.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  type NodeTypes,
  type EdgeTypes,
  type Node,
  type Edge,
  type NodeProps,
  type EdgeProps,
  type ReactFlowInstance,
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  useNodesState,
  useEdgesState,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import dagre from '@dagrejs/dagre';
import { toBlob, toSvg } from 'html-to-image';
import { Download, Search, ZoomIn, LayoutGrid, Palette, LocateFixed } from 'lucide-react';
import type { FlowNode, FlowEdge } from './types';

// ─── Constants ────────────────────────────────────────────────────────────────

const NODE_WIDTH = 220;
const NODE_HEIGHT_LABEL = 90;
const NODE_HEIGHT_MENU = 80;
const ZOOM_PRESETS = [0.5, 0.75, 1, 1.25] as const;

// ─── Custom node data types ───────────────────────────────────────────────────

interface NodeData extends Record<string, unknown> {
  label: string;
  dialogueCount: number;
  nodeType: 'LABEL' | 'MENU';
  chapter?: string;
  parentLabelId?: string;
  theme: 'violet' | 'highContrast' | 'colorblind';
}

type LabelNodeType = Node<NodeData, 'labelNode'>;
type MenuNodeType = Node<NodeData, 'menuNode'>;
type CanvasNode = LabelNodeType | MenuNodeType;

// ─── Custom node components ───────────────────────────────────────────────────

interface ThemeColors {
  pageBg: string;
  panelBg: string;
  text: string;
  subtleText: string;
  labelBorder: string;
  labelBg: string;
  labelTitle: string;
  labelText: string;
  menuBorder: string;
  menuBg: string;
  menuTitle: string;
  menuText: string;
  edge: string;
  grid: string;
  minimapLabel: string;
  minimapMenu: string;
}

const THEMES: Record<'violet' | 'highContrast' | 'colorblind', ThemeColors> = {
  violet: {
    pageBg: '#f9fafb',
    panelBg: '#ffffff',
    text: '#111827',
    subtleText: '#4b5563',
    labelBorder: '#7c3aed',
    labelBg: '#f5f3ff',
    labelTitle: '#8b5cf6',
    labelText: '#4c1d95',
    menuBorder: '#d97706',
    menuBg: '#fffbeb',
    menuTitle: '#f59e0b',
    menuText: '#78350f',
    edge: '#4b5563',
    grid: '#d1d5db',
    minimapLabel: '#8b5cf6',
    minimapMenu: '#f59e0b',
  },
  highContrast: {
    pageBg: '#ffffff',
    panelBg: '#ffffff',
    text: '#000000',
    subtleText: '#111111',
    labelBorder: '#000000',
    labelBg: '#ffffff',
    labelTitle: '#111111',
    labelText: '#000000',
    menuBorder: '#000000',
    menuBg: '#f3f4f6',
    menuTitle: '#111111',
    menuText: '#000000',
    edge: '#000000',
    grid: '#9ca3af',
    minimapLabel: '#000000',
    minimapMenu: '#4b5563',
  },
  colorblind: {
    pageBg: '#f8fafc',
    panelBg: '#ffffff',
    text: '#0f172a',
    subtleText: '#334155',
    labelBorder: '#0072b2',
    labelBg: '#e0f2fe',
    labelTitle: '#0369a1',
    labelText: '#0c4a6e',
    menuBorder: '#e69f00',
    menuBg: '#fff7cc',
    menuTitle: '#a16207',
    menuText: '#713f12',
    edge: '#334155',
    grid: '#cbd5e1',
    minimapLabel: '#0072b2',
    minimapMenu: '#e69f00',
  },
};

function LabelNodeComponent({ data }: NodeProps<LabelNodeType>) {
  const theme = THEMES[(data.theme as keyof typeof THEMES) || 'violet'];
  return (
    <div
      className="px-4 py-3 rounded-xl border-2 shadow-md w-[220px]"
      style={{ borderColor: theme.labelBorder, backgroundColor: theme.labelBg }}
    >
      <Handle type="target" position={Position.Top} />
      <div
        className="text-xs font-semibold uppercase tracking-widest mb-1"
        style={{ color: theme.labelTitle }}
      >
        Label
      </div>
      <div className="font-mono font-bold truncate text-sm" style={{ color: theme.labelText }}>
        {data.label}
      </div>
      {data.dialogueCount > 0 && (
        <div className="mt-1 text-xs" style={{ color: theme.labelTitle }}>
          {data.dialogueCount} dialogue line{data.dialogueCount !== 1 ? 's' : ''}
        </div>
      )}
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

function MenuNodeComponent({ data }: NodeProps<MenuNodeType>) {
  const theme = THEMES[(data.theme as keyof typeof THEMES) || 'violet'];
  return (
    <div
      className="px-4 py-3 rounded-xl border-2 shadow-md w-[220px]"
      style={{ borderColor: theme.menuBorder, backgroundColor: theme.menuBg }}
    >
      <Handle type="target" position={Position.Top} />
      <div
        className="text-xs font-semibold uppercase tracking-widest mb-1"
        style={{ color: theme.menuTitle }}
      >
        Menu
      </div>
      <div className="font-mono font-bold truncate text-sm" style={{ color: theme.menuText }}>
        {data.label}
      </div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

const nodeTypes: NodeTypes = {
  labelNode: LabelNodeComponent,
  menuNode: MenuNodeComponent,
};

// ─── Custom edge data type ────────────────────────────────────────────────────

interface EdgeData extends Record<string, unknown> {
  label: string;
  kind?: 'sequence' | 'jump' | 'call' | 'call_return';
}

type EdgeKindFilter = 'sequence' | 'jump' | 'call' | 'call_return';

type LabeledEdgeType = Edge<EdgeData, 'labeled'>;
type CanvasEdge = LabeledEdgeType;

// ─── Custom edge component ────────────────────────────────────────────────────

function LabeledEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  markerEnd,
  style,
}: EdgeProps<LabeledEdgeType>) {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  return (
    <>
      <BaseEdge id={id} path={edgePath} markerEnd={markerEnd} style={style} />
      {data?.label && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: 'all',
            }}
            className="bg-white border border-gray-200 rounded px-1.5 py-0.5 text-[10px] text-gray-600 max-w-[120px] truncate shadow-sm nodrag nopan"
          >
            {data.label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

const edgeTypes: EdgeTypes = {
  labeled: LabeledEdge,
};

// ─── Dagre layout ─────────────────────────────────────────────────────────────

function applyDagreLayout(
  rawNodes: FlowNode[],
  rawEdges: FlowEdge[],
  direction: 'TB' | 'LR',
): { nodes: CanvasNode[]; edges: CanvasEdge[] } {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: direction,
    // LR layouts place many wide label cards in neighboring columns; extra rank
    // spacing helps reduce crowding and edge-label overlap.
    ranksep: direction === 'TB' ? 80 : 110,
    nodesep: 50,
    marginx: 20,
    marginy: 20,
  });

  rawNodes.forEach((n) => {
    g.setNode(n.id, {
      width: NODE_WIDTH,
      height: n.type === 'LABEL' ? NODE_HEIGHT_LABEL : NODE_HEIGHT_MENU,
    });
  });

  rawEdges.forEach((e) => {
    if (g.hasNode(e.source) && g.hasNode(e.target)) {
      g.setEdge(e.source, e.target);
    }
  });

  dagre.layout(g);

  const nodes: CanvasNode[] = rawNodes.map((n) => {
    const pos = g.node(n.id);
    const h = n.type === 'LABEL' ? NODE_HEIGHT_LABEL : NODE_HEIGHT_MENU;
    return {
      id: n.id,
      type: n.type === 'LABEL' ? 'labelNode' : 'menuNode',
      position: {
        x: pos ? pos.x - NODE_WIDTH / 2 : 0,
        y: pos ? pos.y - h / 2 : 0,
      },
        data: {
          label: n.label,
          dialogueCount: n.dialogueCount,
          nodeType: n.type,
          chapter: n.chapter,
          parentLabelId: n.parentLabelId,
          theme: 'violet',
        },
        draggable: true,
      };
    });

  const edges: CanvasEdge[] = rawEdges
    .filter((e) => g.hasNode(e.source) && g.hasNode(e.target))
    .map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      type: 'labeled',
      data: { label: e.label ?? '', kind: e.kind },
      markerEnd: { type: 'arrowclosed' as const },
      style: { stroke: '#6b7280', strokeWidth: 1.5 },
    }));

  return { nodes, edges };
}

function getNodeCenter(node: CanvasNode): { x: number; y: number } {
  const nodeHeight = node.type === 'labelNode' ? NODE_HEIGHT_LABEL : NODE_HEIGHT_MENU;
  return {
    x: node.position.x + NODE_WIDTH / 2,
    y: node.position.y + nodeHeight / 2,
  };
}

// ─── Main component ───────────────────────────────────────────────────────────

interface FlowchartViewerProps {
  flowNodes: FlowNode[];
  flowEdges: FlowEdge[];
}

export default function FlowchartViewer({
  flowNodes,
  flowEdges,
}: FlowchartViewerProps) {
  const flowRef = useRef<HTMLDivElement>(null);
  const flowInstanceRef = useRef<ReactFlowInstance<CanvasNode, CanvasEdge> | null>(null);
  const [layoutDirection, setLayoutDirection] = useState<'TB' | 'LR'>('TB');
  const [search, setSearch] = useState('');
  const [minDialogue, setMinDialogue] = useState(0);
  const [theme, setTheme] = useState<'violet' | 'highContrast' | 'colorblind'>(() => {
    const raw = globalThis.localStorage?.getItem('rfv.theme');
    if (raw === 'violet' || raw === 'highContrast' || raw === 'colorblind') return raw;
    return 'violet';
  });
  const [collapsedChapters, setCollapsedChapters] = useState<Record<string, boolean>>({});
  const [collapsedParentLabels, setCollapsedParentLabels] = useState<Record<string, boolean>>({});
  const [showCallReturns, setShowCallReturns] = useState(() => globalThis.localStorage?.getItem('rfv.showCallReturns') === 'true');
  const [visibleEdgeKinds, setVisibleEdgeKinds] = useState<Record<EdgeKindFilter, boolean>>(() => ({
    sequence: globalThis.localStorage?.getItem('rfv.edge.sequence') !== 'false',
    jump: globalThis.localStorage?.getItem('rfv.edge.jump') !== 'false',
    call: globalThis.localStorage?.getItem('rfv.edge.call') !== 'false',
    call_return: globalThis.localStorage?.getItem('rfv.edge.call_return') !== 'false',
  }));
  const [focusNodeId, setFocusNodeId] = useState<string>('');
  const searchInputRef = useRef<HTMLInputElement>(null);

  const { nodes: layoutNodes, edges: layoutEdges } = useMemo(
    () => applyDagreLayout(flowNodes, flowEdges, layoutDirection),
    [flowNodes, flowEdges, layoutDirection],
  );
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
    globalThis.localStorage?.setItem('rfv.theme', theme);
  }, [theme]);

  useEffect(() => {
    globalThis.localStorage?.setItem('rfv.showCallReturns', String(showCallReturns));
  }, [showCallReturns]);

  useEffect(() => {
    globalThis.localStorage?.setItem('rfv.edge.sequence', String(visibleEdgeKinds.sequence));
    globalThis.localStorage?.setItem('rfv.edge.jump', String(visibleEdgeKinds.jump));
    globalThis.localStorage?.setItem('rfv.edge.call', String(visibleEdgeKinds.call));
    globalThis.localStorage?.setItem('rfv.edge.call_return', String(visibleEdgeKinds.call_return));
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

  const visibleNodes = useMemo(() => {
    const query = search.trim().toLowerCase();
    return nodes.map((n) => {
      const nodeData = n.data as NodeData;
      const chapterCollapsed = nodeData.chapter ? collapsedChapters[nodeData.chapter] : false;
      const labelCollapsed = collapsedLabelChildren.has(n.id);
      const matchesSearch =
        query.length === 0 ||
        nodeData.label.toLowerCase().includes(query) ||
        String(nodeData.dialogueCount).includes(query);
      const matchesDialogue = nodeData.dialogueCount >= minDialogue;
      return {
        ...n,
        data: { ...nodeData, theme },
        hidden: Boolean(chapterCollapsed || labelCollapsed || !matchesSearch || !matchesDialogue),
      };
    });
  }, [collapsedChapters, collapsedLabelChildren, minDialogue, nodes, search, theme]);

  const visibleNodeIds = useMemo(
    () => new Set(visibleNodes.filter((n) => !n.hidden).map((n) => n.id)),
    [visibleNodes],
  );

  const visibleEdges = useMemo(
    () =>
      edges
        .map((e) => ({ ...e, style: { ...(e.style || {}), stroke: THEMES[theme].edge, strokeWidth: 1.5 } }))
        .filter((e) => {
          const kind = ((e.data as EdgeData | undefined)?.kind ?? 'sequence') as EdgeKindFilter;
          if (!visibleEdgeKinds[kind]) return false;
          if (!showCallReturns && kind === 'call_return') return false;
          return true;
        })
        .filter((e) => visibleNodeIds.has(e.source) && visibleNodeIds.has(e.target)),
    [edges, showCallReturns, theme, visibleEdgeKinds, visibleNodeIds],
  );

  const onExport = useCallback(() => {
    if (!flowRef.current) return;
    toBlob(flowRef.current, {
      backgroundColor: THEMES[theme].pageBg,
      pixelRatio: 2,
      width: flowRef.current.offsetWidth,
      height: flowRef.current.offsetHeight,
    })
      .then((blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.download = 'renpy-flowchart.png';
        a.href = url;
        a.click();
        URL.revokeObjectURL(url);
      })
      .catch((err: unknown) => {
        console.error('Export failed:', err);
      });
  }, [theme]);

  const onExportSvg = useCallback(() => {
    if (!flowRef.current) return;
    toSvg(flowRef.current, {
      backgroundColor: THEMES[theme].pageBg,
      width: flowRef.current.offsetWidth,
      height: flowRef.current.offsetHeight,
    })
      .then((svgDataUrl) => {
        const a = document.createElement('a');
        a.download = 'renpy-flowchart.svg';
        a.href = svgDataUrl;
        a.click();
      })
      .catch((err: unknown) => {
        console.error('SVG export failed:', err);
      });
  }, [theme]);


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

  return (
    <div className="flex flex-col h-full" style={{ backgroundColor: THEMES[theme].pageBg, color: THEMES[theme].text }}>
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200 bg-white shrink-0 gap-4">
        <div className="text-sm" style={{ color: THEMES[theme].subtleText }}>
          {visibleNodeIds.size} / {flowNodes.length} node{flowNodes.length !== 1 ? 's' : ''} ·{' '}
          {visibleEdges.length} / {flowEdges.length} edge{flowEdges.length !== 1 ? 's' : ''}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <label className="relative flex items-center">
            <Search size={14} className="absolute left-2 text-gray-400" aria-hidden="true" />
            <input
              ref={searchInputRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search labels or dialogue count"
              aria-label="Search labels or dialogue count"
              className="pl-7 pr-2 py-1 text-sm border border-gray-300 rounded-md w-60"
            />
          </label>
          <label className="text-xs flex items-center gap-1">
            Min dialogue
            <input
              type="number"
              min={0}
              value={minDialogue}
              onChange={(e) => setMinDialogue(Number(e.target.value) || 0)}
              aria-label="Minimum dialogue lines"
              className="w-16 px-2 py-1 border border-gray-300 rounded-md text-sm"
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
            <LayoutGrid size={14} aria-hidden="true" />
            Layout
            <select
              value={layoutDirection}
              onChange={(e) => setLayoutDirection(e.target.value as 'TB' | 'LR')}
              aria-label="Auto layout direction"
              className="px-2 py-1 border border-gray-300 rounded-md text-sm"
            >
              <option value="TB">Top to bottom</option>
              <option value="LR">Left to right</option>
            </select>
          </label>
          <button
            onClick={relayout}
            className="px-2 py-1 text-xs border border-gray-300 rounded-md hover:bg-gray-50"
            aria-label="Re-run auto layout"
          >
            Auto-layout
          </button>
          <label className="text-xs flex items-center gap-1">
            <Palette size={14} aria-hidden="true" />
            Theme
            <select
              value={theme}
              onChange={(e) => setTheme(e.target.value as 'violet' | 'highContrast' | 'colorblind')}
              aria-label="Color theme"
              className="px-2 py-1 border border-gray-300 rounded-md text-sm"
            >
              <option value="violet">Default</option>
              <option value="highContrast">High contrast</option>
              <option value="colorblind">Colorblind-safe</option>
            </select>
          </label>

          <label className="text-xs flex items-center gap-1">
            Focus label
            <select
              value={focusNodeId}
              onChange={(e) => setFocusNodeId(e.target.value)}
              aria-label="Focus label"
              className="px-2 py-1 border border-gray-300 rounded-md text-sm"
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
              className="px-2 py-1 text-xs border border-gray-300 rounded-md hover:bg-gray-50"
              aria-label="Center selected label"
            >
              <LocateFixed size={12} className="inline mr-1" aria-hidden="true" />
              Center
            </button>
          </label>
          <div className="flex items-center gap-1 text-xs">
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
              className="px-2 py-1 text-xs border border-gray-300 rounded-md hover:bg-gray-50"
              aria-label={`Zoom to ${Math.round(preset * 100)} percent`}
            >
              <ZoomIn size={12} className="inline mr-1" aria-hidden="true" />
              {Math.round(preset * 100)}%
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onExport}
            aria-label="Export flowchart as PNG"
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-violet-600 hover:bg-violet-700 rounded-lg transition-colors"
          >
            <Download size={14} aria-hidden="true" />
            Export PNG
          </button>
          <button
            onClick={onExportSvg}
            aria-label="Export flowchart as SVG"
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-violet-700 border border-violet-300 bg-white hover:bg-violet-50 rounded-lg transition-colors"
          >
            <Download size={14} aria-hidden="true" />
            Export SVG
          </button>
          <button
            onClick={onExportJson}
            aria-label="Export graph as JSON"
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-700 border border-gray-300 bg-white hover:bg-gray-50 rounded-lg transition-colors"
          >
            <Download size={14} aria-hidden="true" />
            Export JSON
          </button>
        </div>
      </div>

      <div className="shrink-0 border-b border-gray-200 px-4 py-2 bg-white flex flex-wrap gap-4 text-xs">
        {chapters.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="font-semibold">Chapter subgraphs:</span>
            {chapters.map((chapter) => (
              <button
                key={chapter}
                onClick={() =>
                  setCollapsedChapters((prev) => ({ ...prev, [chapter]: !prev[chapter] }))
                }
                className="px-2 py-1 border border-gray-300 rounded-md hover:bg-gray-50"
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
                className="px-2 py-1 border border-gray-300 rounded-md hover:bg-gray-50"
                aria-label={`${collapsedParentLabels[label] ? 'Expand' : 'Collapse'} label ${label}`}
              >
                {collapsedParentLabels[label] ? '▸' : '▾'} {label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Flow canvas */}
      <div ref={flowRef} className="flex-1" style={{ backgroundColor: THEMES[theme].pageBg }}>
        <ReactFlow
          nodes={visibleNodes}
          edges={visibleEdges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
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
    </div>
  );
}
