/**
 * src/FlowchartViewer.tsx
 *
 * Renders the parsed Ren'Py flowchart using React Flow + dagre.
 * Exports a high-resolution PNG via html-to-image.
 */

import { useCallback, useMemo, useRef } from 'react';
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
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import dagre from '@dagrejs/dagre';
import { toBlob } from 'html-to-image';
import { Download } from 'lucide-react';
import type { FlowNode, FlowEdge } from './types';

// ─── Constants ────────────────────────────────────────────────────────────────

const NODE_WIDTH = 220;
const NODE_HEIGHT_LABEL = 90;
const NODE_HEIGHT_MENU = 80;

// ─── Custom node data types ───────────────────────────────────────────────────

interface NodeData extends Record<string, unknown> {
  label: string;
  dialogueCount: number;
  nodeType: 'LABEL' | 'MENU';
}

type LabelNodeType = Node<NodeData, 'labelNode'>;
type MenuNodeType = Node<NodeData, 'menuNode'>;

// ─── Custom node components ───────────────────────────────────────────────────

function LabelNodeComponent({ data }: NodeProps<LabelNodeType>) {
  return (
    <div className="px-4 py-3 rounded-xl border-2 border-violet-500 bg-violet-50 shadow-md w-[220px]">
      <Handle type="target" position={Position.Top} />
      <div className="text-xs font-semibold text-violet-400 uppercase tracking-widest mb-1">
        Label
      </div>
      <div className="font-mono font-bold text-violet-900 truncate text-sm">
        {data.label}
      </div>
      {data.dialogueCount > 0 && (
        <div className="mt-1 text-xs text-violet-600">
          {data.dialogueCount} dialogue line{data.dialogueCount !== 1 ? 's' : ''}
        </div>
      )}
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

function MenuNodeComponent({ data }: NodeProps<MenuNodeType>) {
  return (
    <div className="px-4 py-3 rounded-xl border-2 border-amber-500 bg-amber-50 shadow-md w-[220px]">
      <Handle type="target" position={Position.Top} />
      <div className="text-xs font-semibold text-amber-400 uppercase tracking-widest mb-1">
        Menu
      </div>
      <div className="font-mono font-bold text-amber-900 truncate text-sm">
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
}

type LabeledEdgeType = Edge<EdgeData, 'labeled'>;

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
): { nodes: Node[]; edges: Edge[] } {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: 'TB', ranksep: 80, nodesep: 50, marginx: 20, marginy: 20 });

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

  const nodes: Node[] = rawNodes.map((n) => {
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
      },
    };
  });

  const edges: Edge[] = rawEdges
    .filter((e) => g.hasNode(e.source) && g.hasNode(e.target))
    .map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      type: 'labeled',
      data: { label: e.label ?? '' },
      markerEnd: { type: 'arrowclosed' as const },
      style: { stroke: '#6b7280', strokeWidth: 1.5 },
    }));

  return { nodes, edges };
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

  const { nodes, edges } = useMemo(
    () => applyDagreLayout(flowNodes, flowEdges),
    [flowNodes, flowEdges],
  );

  const onExport = useCallback(() => {
    if (!flowRef.current) return;
    toBlob(flowRef.current, {
      backgroundColor: '#f9fafb',
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
  }, []);

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200 bg-white shrink-0">
        <div className="text-sm text-gray-500">
          {flowNodes.length} node{flowNodes.length !== 1 ? 's' : ''} ·{' '}
          {flowEdges.length} edge{flowEdges.length !== 1 ? 's' : ''}
        </div>
        <button
          onClick={onExport}
          aria-label="Export flowchart as PNG"
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-violet-600 hover:bg-violet-700 rounded-lg transition-colors"
        >
          <Download size={14} aria-hidden="true" />
          Export PNG
        </button>
      </div>

      {/* Flow canvas */}
      <div ref={flowRef} className="flex-1 bg-gray-50">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          minZoom={0.1}
          maxZoom={2}
          proOptions={{ hideAttribution: false }}
        >
          <Background color="#e5e7eb" gap={20} />
          <Controls />
          <MiniMap
            nodeColor={(n) =>
              n.type === 'labelNode' ? '#ddd6fe' : '#fde68a'
            }
          />
        </ReactFlow>
      </div>
    </div>
  );
}
