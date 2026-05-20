import { describe, expect, it } from 'vitest';
import {
  applyDagreLayout,
  buildConditionalVisibility,
  buildVisibleEdges,
  buildVisibleNodes,
  getNodeCenter,
  PROGRESSIVE_LAYOUT_NODE_LIMIT,
  type CanvasEdge,
  type CanvasNode,
} from '../src/flowchartTransforms';
import type { FlowNode, FlowEdge } from '../src/domain';

describe('flowchartTransforms', () => {
  const flowNodes: FlowNode[] = [
    {
      id: 'start',
      type: 'LABEL',
      label: 'start',
      dialogueCount: 2,
      dialogueLines: ['hello there', 'general kenobi'],
      chapter: 'ch1',
    },
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

  it('preserves shadow and terminal metadata on label node data', () => {
    const result = applyDagreLayout(
      [
        {
          id: 'ending',
          type: 'LABEL',
          label: 'ending',
          dialogueCount: 0,
          isShadowed: true,
          shadowOfId: 'ending_canonical',
          isTerminalOutcome: true,
        },
      ],
      [],
      'TB',
    );
    const nodeData = result.nodes[0]?.data as {
      isShadowed?: boolean;
      shadowOfId?: string;
      isTerminalOutcome?: boolean;
    };
    expect(nodeData.isShadowed).toBe(true);
    expect(nodeData.shadowOfId).toBe('ending_canonical');
    expect(nodeData.isTerminalOutcome).toBe(true);
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

  it('matches search against dialogue lines', () => {
    const layout = applyDagreLayout(flowNodes, flowEdges, 'TB');
    const visible = buildVisibleNodes({
      nodes: layout.nodes,
      search: 'kenobi',
      minDialogue: 0,
      collapsedChapters: { ch1: false },
      collapsedLabelChildren: new Set<string>(),
      theme: 'violet',
    });
    const byId = new Map(visible.map((n) => [n.id, n]));
    expect(byId.get('start')?.hidden).toBe(false);
    expect(byId.get('menu_1')?.hidden).toBe(true);
  });

  it('can disable dialogue-line matching in performance mode', () => {
    const layout = applyDagreLayout(flowNodes, flowEdges, 'TB');
    const visible = buildVisibleNodes({
      nodes: layout.nodes,
      search: 'kenobi',
      includeDialogueLineSearch: false,
      minDialogue: 0,
      collapsedChapters: { ch1: false },
      collapsedLabelChildren: new Set<string>(),
      theme: 'violet',
    });
    const byId = new Map(visible.map((n) => [n.id, n]));
    expect(byId.get('start')?.hidden).toBe(true);
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

  it('creates placeholder nodes for unresolved edge endpoints before layout', () => {
    const result = applyDagreLayout(
      [{ id: 'start', type: 'LABEL', label: 'start', dialogueCount: 0 }],
      [{ id: 'jump_start__missing', source: 'start', target: 'missing_label', kind: 'jump' }],
      'TB',
    );
    expect(result.nodes.some((node) => node.id === 'missing_label')).toBe(true);
    expect(result.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: 'start', target: 'missing_label' }),
      ]),
    );
  });

  it('deduplicates nodes with the same id', () => {
    const result = applyDagreLayout(
      [
        { id: 'start', type: 'LABEL', label: 'start', dialogueCount: 0 },
        { id: 'start', type: 'LABEL', label: 'start duplicate', dialogueCount: 0 },
      ],
      [],
      'TB',
    );
    const startNodes = result.nodes.filter((n) => n.id === 'start');
    expect(startNodes).toHaveLength(1);
  });

  it('deduplicates semantically identical edges', () => {
    const result = applyDagreLayout(
      [
        { id: 'a', type: 'LABEL', label: 'a', dialogueCount: 0 },
        { id: 'b', type: 'LABEL', label: 'b', dialogueCount: 0 },
      ],
      [
        { id: 'e1', source: 'a', target: 'b', kind: 'sequence' },
        { id: 'e2', source: 'a', target: 'b', kind: 'sequence' },
      ],
      'TB',
    );
    expect(result.edges).toHaveLength(1);
  });

  it('applies LR layout direction', () => {
    const result = applyDagreLayout(flowNodes, flowEdges, 'LR');
    expect(result.nodes).toHaveLength(2);
    expect(result.edges).toHaveLength(1);
  });

  it('progressive layout handles more than PROGRESSIVE_LAYOUT_NODE_LIMIT nodes', () => {
    const manyNodes: FlowNode[] = Array.from({ length: PROGRESSIVE_LAYOUT_NODE_LIMIT + 5 }, (_, i) => ({
      id: `n${i}`,
      type: 'LABEL' as const,
      label: `n${i}`,
      dialogueCount: 0,
    }));
    const result = applyDagreLayout(manyNodes, [], 'TB', { progressive: true });
    expect(result.nodes).toHaveLength(manyNodes.length);
    // All nodes must have been assigned a position.
    for (const node of result.nodes) {
      expect(typeof node.position.x).toBe('number');
      expect(typeof node.position.y).toBe('number');
    }
  });

  it('progressive layout respects previousPositions for overflow nodes', () => {
    const manyNodes: FlowNode[] = Array.from({ length: PROGRESSIVE_LAYOUT_NODE_LIMIT + 2 }, (_, i) => ({
      id: `n${i}`,
      type: 'LABEL' as const,
      label: `n${i}`,
      dialogueCount: 0,
    }));
    const previousPos = new Map([
      [`n${PROGRESSIVE_LAYOUT_NODE_LIMIT}`, { x: 999, y: 888 }],
    ]);
    const result = applyDagreLayout(manyNodes, [], 'TB', { progressive: true, previousPositions: previousPos });
    const overflowNode = result.nodes.find((n) => n.id === `n${PROGRESSIVE_LAYOUT_NODE_LIMIT}`);
    expect(overflowNode?.position).toEqual({ x: 999, y: 888 });
  });

  it('buildVisibleNodes hides nodes whose chapter is collapsed', () => {
    const layout = applyDagreLayout(flowNodes, flowEdges, 'TB');
    const visible = buildVisibleNodes({
      nodes: layout.nodes,
      search: '',
      minDialogue: 0,
      collapsedChapters: { ch1: true },
      collapsedLabelChildren: new Set<string>(),
      theme: 'violet',
    });
    // start has chapter ch1 which is collapsed — should be hidden.
    expect(visible.find((n) => n.id === 'start')?.hidden).toBe(true);
  });

  it('buildVisibleNodes matches nodes via searchMatchNodeIds', () => {
    const layout = applyDagreLayout(flowNodes, flowEdges, 'TB');
    const visible = buildVisibleNodes({
      nodes: layout.nodes,
      search: 'irrelevant',
      searchMatchNodeIds: new Set(['menu_1']),
      minDialogue: 0,
      collapsedChapters: { ch1: false },
      collapsedLabelChildren: new Set<string>(),
      theme: 'violet',
    });
    const byId = new Map(visible.map((n) => [n.id, n]));
    expect(byId.get('menu_1')?.hidden).toBe(false);
    expect(byId.get('start')?.hidden).toBe(true);
  });

  it('buildVisibleNodes matches nodes via dialogueMatchNodeIds', () => {
    const layout = applyDagreLayout(flowNodes, flowEdges, 'TB');
    const visible = buildVisibleNodes({
      nodes: layout.nodes,
      search: 'irrelevant',
      searchMatchNodeIds: new Set<string>(),
      dialogueMatchNodeIds: new Set(['start']),
      minDialogue: 0,
      collapsedChapters: { ch1: false },
      collapsedLabelChildren: new Set<string>(),
      theme: 'violet',
    });
    const byId = new Map(visible.map((n) => [n.id, n]));
    expect(byId.get('start')?.hidden).toBe(false);
    expect(byId.get('menu_1')?.hidden).toBe(true);
  });

  it('buildVisibleNodes returns previous node instance when nothing has changed', () => {
    const layout = applyDagreLayout(flowNodes, flowEdges, 'TB');
    const first = buildVisibleNodes({
      nodes: layout.nodes,
      search: '',
      minDialogue: 0,
      collapsedChapters: { ch1: false },
      collapsedLabelChildren: new Set<string>(),
      theme: 'violet',
    });
    const byId = new Map(first.map((n) => [n.id, n]));
    const second = buildVisibleNodes({
      nodes: layout.nodes,
      search: '',
      minDialogue: 0,
      collapsedChapters: { ch1: false },
      collapsedLabelChildren: new Set<string>(),
      theme: 'violet',
      previousById: byId,
    });
    // Should return the exact same object references when nothing changed.
    expect(second.find((n) => n.id === 'start')).toBe(first.find((n) => n.id === 'start'));
  });

  it('buildVisibleEdges filters out call_return edges when showCallReturns is false', () => {
    const callReturnEdge: FlowEdge = {
      id: 'ret_start__menu_1',
      source: 'start',
      target: 'menu_1',
      kind: 'call_return',
    };
    const layout = applyDagreLayout(flowNodes, [callReturnEdge], 'TB');
    const edges = buildVisibleEdges({
      edges: layout.edges as CanvasEdge[],
      showCallReturns: false,
      visibleEdgeKinds: { sequence: true, jump: true, call: true, call_return: true },
      visibleNodeIds: new Set(['start', 'menu_1']),
      edgeColor: '#111',
      largeGraphMode: false,
    });
    expect(edges).toHaveLength(0);
  });

  it('buildVisibleEdges includes call_return edges when showCallReturns is true', () => {
    const callReturnEdge: FlowEdge = {
      id: 'ret_start__menu_1',
      source: 'start',
      target: 'menu_1',
      kind: 'call_return',
    };
    const layout = applyDagreLayout(flowNodes, [callReturnEdge], 'TB');
    const edges = buildVisibleEdges({
      edges: layout.edges as CanvasEdge[],
      showCallReturns: true,
      visibleEdgeKinds: { sequence: true, jump: true, call: true, call_return: true },
      visibleNodeIds: new Set(['start', 'menu_1']),
      edgeColor: '#111',
      largeGraphMode: false,
    });
    expect(edges).toHaveLength(1);
  });

  it('buildVisibleEdges filters out edges with disabled kinds', () => {
    const layout = applyDagreLayout(flowNodes, flowEdges, 'TB');
    const edges = buildVisibleEdges({
      edges: layout.edges as CanvasEdge[],
      showCallReturns: true,
      visibleEdgeKinds: { sequence: false, jump: true, call: true, call_return: true },
      visibleNodeIds: new Set(['start', 'menu_1']),
      edgeColor: '#111',
      largeGraphMode: false,
    });
    expect(edges).toHaveLength(0);
  });

  it('buildVisibleEdges filters out edges whose source or target node is not visible', () => {
    const layout = applyDagreLayout(flowNodes, flowEdges, 'TB');
    const edges = buildVisibleEdges({
      edges: layout.edges as CanvasEdge[],
      showCallReturns: true,
      visibleEdgeKinds: { sequence: true, jump: true, call: true, call_return: true },
      visibleNodeIds: new Set(['start']), // menu_1 is excluded
      edgeColor: '#111',
      largeGraphMode: false,
    });
    expect(edges).toHaveLength(0);
  });

  it('buildVisibleEdges reuses previous edge instance when nothing changed', () => {
    const layout = applyDagreLayout(flowNodes, flowEdges, 'TB');
    const first = buildVisibleEdges({
      edges: layout.edges as CanvasEdge[],
      showCallReturns: true,
      visibleEdgeKinds: { sequence: true, jump: true, call: true, call_return: true },
      visibleNodeIds: new Set(['start', 'menu_1']),
      edgeColor: '#aaa',
      largeGraphMode: false,
    });
    const prevById = new Map(first.map((e) => [e.id, e]));
    const second = buildVisibleEdges({
      edges: layout.edges as CanvasEdge[],
      showCallReturns: true,
      visibleEdgeKinds: { sequence: true, jump: true, call: true, call_return: true },
      visibleNodeIds: new Set(['start', 'menu_1']),
      edgeColor: '#aaa',
      largeGraphMode: false,
      previousById: prevById,
    });
    expect(second[0]).toBe(first[0]);
  });

  it('evaluates conditional reachability and discovers mock flags from edge conditions', () => {
    const layout = applyDagreLayout(
      [
        { id: 'start', type: 'LABEL', label: 'start', dialogueCount: 0 },
        { id: 'decision_1', type: 'DECISION', label: 'if flag', dialogueCount: 0 },
        { id: 'branch_true', type: 'LABEL', label: 'branch_true', dialogueCount: 0 },
        { id: 'branch_false', type: 'LABEL', label: 'branch_false', dialogueCount: 0 },
      ],
      [
        { id: 'seq_start__decision_1', source: 'start', target: 'decision_1', kind: 'sequence' },
        {
          id: 'jump_decision_1__branch_true',
          source: 'decision_1',
          target: 'branch_true',
          kind: 'jump',
          condition: { branchKind: 'if', expression: 'flag_x', references: ['flag_x'], decisionNodeId: 'decision_1' },
        },
        {
          id: 'jump_decision_1__branch_false',
          source: 'decision_1',
          target: 'branch_false',
          kind: 'jump',
          condition: { branchKind: 'else', decisionNodeId: 'decision_1' },
        },
      ],
      'TB',
    );

    const visibility = buildConditionalVisibility({
      edges: layout.edges as CanvasEdge[],
      mockFlags: { flag_x: 'false' },
    });
    expect(visibility.discoveredFlags).toEqual(['flag_x']);
    expect(visibility.edgeConditionStateById.get('jump_decision_1__branch_true')).toBe('unreachable');
    expect(visibility.edgeConditionStateById.get('jump_decision_1__branch_false')).toBe('unknown');
  });

  it('hides unreachable conditional edges when mode is hide', () => {
    const layout = applyDagreLayout(
      [
        { id: 'decision', type: 'DECISION', label: 'if f', dialogueCount: 0 },
        { id: 'a', type: 'LABEL', label: 'a', dialogueCount: 0 },
        { id: 'b', type: 'LABEL', label: 'b', dialogueCount: 0 },
      ],
      [
        { id: 'e1', source: 'decision', target: 'a', kind: 'jump', condition: { branchKind: 'if', expression: 'f' } },
        { id: 'e2', source: 'decision', target: 'b', kind: 'jump', condition: { branchKind: 'else' } },
      ],
      'TB',
    );
    const conditional = buildConditionalVisibility({ edges: layout.edges as CanvasEdge[], mockFlags: { f: 'false' } });
    const edges = buildVisibleEdges({
      edges: layout.edges as CanvasEdge[],
      showCallReturns: true,
      visibleEdgeKinds: { sequence: true, jump: true, call: true, call_return: true },
      visibleNodeIds: new Set(['decision', 'a', 'b']),
      edgeColor: '#111',
      largeGraphMode: false,
      conditionVisibilityMode: 'hide',
      edgeConditionStateById: conditional.edgeConditionStateById,
    });
    expect(edges.map((edge) => edge.id)).toEqual(['e2']);
  });

  it('propagates hide-mode reachability through downstream sequence edges', () => {
    const layout = applyDagreLayout(
      [
        { id: 'start', type: 'LABEL', label: 'start', dialogueCount: 0 },
        { id: 'decision', type: 'DECISION', label: 'if f', dialogueCount: 0 },
        { id: 'branch_false', type: 'LABEL', label: 'branch_false', dialogueCount: 0 },
        { id: 'downstream', type: 'LABEL', label: 'downstream', dialogueCount: 0 },
      ],
      [
        { id: 'start_decision', source: 'start', target: 'decision', kind: 'sequence' },
        { id: 'decision_false_branch', source: 'decision', target: 'branch_false', kind: 'jump', condition: { branchKind: 'if', expression: 'f' } },
        { id: 'branch_downstream', source: 'branch_false', target: 'downstream', kind: 'sequence' },
      ],
      'TB',
    );

    const conditional = buildConditionalVisibility({
      edges: layout.edges as CanvasEdge[],
      mockFlags: { f: 'false' },
    });
    expect(conditional.hiddenNodeIds.has('branch_false')).toBe(true);
    expect(conditional.hiddenNodeIds.has('downstream')).toBe(true);
  });
});
