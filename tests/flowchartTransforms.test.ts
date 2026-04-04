import { describe, expect, it } from 'vitest';
import {
  applyDagreLayout,
  buildVisibleEdges,
  buildVisibleNodes,
  getNodeCenter,
  type CanvasEdge,
  type CanvasNode,
} from '../src/flowchartTransforms';
import type { FlowNode, FlowEdge } from '../src/types';

describe('flowchartTransforms', () => {
  const flowNodes: FlowNode[] = [
    { id: 'start', type: 'LABEL', label: 'start', dialogueCount: 2, chapter: 'ch1' },
    { id: 'menu_1', type: 'MENU', label: 'menu', dialogueCount: 0, parentLabelId: 'start' },
  ];
  const flowEdges: FlowEdge[] = [
    { id: 'seq_start__menu_1', source: 'start', target: 'menu_1', kind: 'sequence', label: 'pick' },
  ];

  it('applies dagre layout and returns canvas nodes/edges', () => {
    const result = applyDagreLayout(flowNodes, flowEdges, 'TB');
    expect(result.nodes).toHaveLength(2);
    expect(result.edges).toHaveLength(1);
    expect(result.nodes[0]).toEqual(expect.objectContaining({ id: 'start' }));
  });

  it('computes node center based on node type dimensions', () => {
    const result = applyDagreLayout(flowNodes, flowEdges, 'TB');
    const node = result.nodes[0] as CanvasNode;
    const center = getNodeCenter(node);
    expect(typeof center.x).toBe('number');
    expect(typeof center.y).toBe('number');
  });

  it('builds visible nodes with search/min dialogue/chapter and label collapse filters', () => {
    const layout = applyDagreLayout(flowNodes, flowEdges, 'TB');
    const visible = buildVisibleNodes({
      nodes: layout.nodes,
      search: 'start',
      minDialogue: 1,
      collapsedChapters: { ch1: false },
      collapsedLabelChildren: new Set<string>(['menu_1']),
      theme: 'violet',
    });
    const byId = new Map(visible.map((n) => [n.id, n]));
    expect(byId.get('start')?.hidden).toBe(false);
    expect(byId.get('menu_1')?.hidden).toBe(true);
  });

  it('builds visible edges with kind filters and large-graph label suppression', () => {
    const layout = applyDagreLayout(flowNodes, flowEdges, 'TB');
    const edges = buildVisibleEdges({
      edges: layout.edges as CanvasEdge[],
      showCallReturns: true,
      visibleEdgeKinds: { sequence: true, jump: true, call: true, call_return: true },
      visibleNodeIds: new Set(['start', 'menu_1']),
      edgeColor: '#111',
      largeGraphMode: true,
    });
    expect(edges).toHaveLength(1);
    expect((edges[0].data as { label: string }).label).toBe('');
  });
});
