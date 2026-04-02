// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import FlowchartViewer from '../src/FlowchartViewer';
import type { FlowNode, FlowEdge } from '../src/types';
import * as ReactFlowLib from '@xyflow/react';

vi.mock('@xyflow/react', () => {
  const flowApi = { zoomTo: vi.fn(), fitView: vi.fn() };

  const ReactFlow = ({
    nodes,
    edges,
    nodeTypes,
    edgeTypes,
    onInit,
    children,
  }: {
    nodes: Array<{
      id: string;
      type?: string;
      position: { x: number; y: number };
      data?: { label?: string; dialogueCount?: number };
    }>;
    edges: Array<{
      id: string;
      source: string;
      target: string;
      data?: { label?: string };
      style?: Record<string, unknown>;
    }>;
    nodeTypes?: Record<string, React.ComponentType<unknown>>;
    edgeTypes?: Record<string, React.ComponentType<unknown>>;
    onInit?: (instance: unknown) => void;
    children?: React.ReactNode;
  }) => {
    React.useEffect(() => {
      onInit?.(flowApi);
    }, [onInit]);
    return (
      <div data-testid="react-flow">
        {nodes.map((n) => {
          const NodeComp = n.type && nodeTypes ? nodeTypes[n.type] : null;
          return NodeComp ? (
            <NodeComp
              key={n.id}
              id={n.id}
              data={n.data}
              selected={false}
              dragging={false}
              isConnectable
              xPos={n.position.x}
              yPos={n.position.y}
              zIndex={0}
              type={n.type}
            />
          ) : null;
        })}
        {edges.map((e) => {
          const EdgeComp = edgeTypes?.labeled;
          return EdgeComp ? (
            <EdgeComp
              key={e.id}
              id={e.id}
              sourceX={0}
              sourceY={0}
              targetX={10}
              targetY={10}
              sourcePosition="bottom"
              targetPosition="top"
              markerEnd="arrow"
              style={e.style}
              data={e.data}
            />
          ) : null;
        })}
        {children}
      </div>
    );
  };

  const Background = () => null;
  const Controls = () => null;
  const MiniMap = ({
    nodeColor,
  }: {
    nodeColor?: (node: { type?: string }) => string;
  }) => (
    <div data-testid="mini-map-colors">
      {[nodeColor?.({ type: 'labelNode' }), nodeColor?.({ type: 'menuNode' })]
        .filter((v): v is string => Boolean(v))
        .join(',')}
    </div>
  );
  const Handle = () => null;
  const BaseEdge = ({ id, path }: { id: string; path: string }) => (
    <div data-testid={`base-edge-${id}`}>{path}</div>
  );
  const EdgeLabelRenderer = ({ children }: { children: React.ReactNode }) => (
    <div data-testid="edge-label">{children}</div>
  );
  const getBezierPath = vi.fn(() => ['M 1 1', 10, 20] as [string, number, number]);
  const Position = { Top: 'top', Bottom: 'bottom', Left: 'left', Right: 'right' };
  const MarkerType = { ArrowClosed: 'arrowclosed' };
  const useNodesState = (initial: unknown[]) => {
    const [nodes, setNodes] = React.useState(initial);
    return [nodes, setNodes, vi.fn()] as const;
  };
  const useEdgesState = (initial: unknown[]) => {
    const [edges, setEdges] = React.useState(initial);
    return [edges, setEdges, vi.fn()] as const;
  };

  return {
    ReactFlow,
    Background,
    Controls,
    MiniMap,
    Handle,
    BaseEdge,
    EdgeLabelRenderer,
    getBezierPath,
    Position,
    MarkerType,
    useNodesState,
    useEdgesState,
    __test: { flowApi },
  };
});

describe('FlowchartViewer behavior coverage', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  const flowNodes: FlowNode[] = [
    {
      id: 'start',
      type: 'LABEL',
      label: 'start',
      dialogueCount: 2,
      chapter: 'chapter1',
    },
    {
      id: 'menu_1',
      type: 'MENU',
      label: 'choices',
      dialogueCount: 0,
      chapter: 'chapter1',
      parentLabelId: 'start',
    },
  ];

  const flowEdges: FlowEdge[] = [
    {
      id: 'seq_start__menu_1',
      source: 'start',
      target: 'menu_1',
      kind: 'sequence',
      label: 'pick',
    },
  ];

  it('renders custom node and edge components including minimap node colors', () => {
    render(<FlowchartViewer flowNodes={flowNodes} flowEdges={flowEdges} />);

    expect(screen.getByText('Label')).toBeInTheDocument();
    expect(screen.getByText('Menu')).toBeInTheDocument();
    expect(screen.getByText('2 dialogue lines')).toBeInTheDocument();
    expect(screen.getByTestId('base-edge-seq_start__menu_1')).toBeInTheDocument();
    expect(screen.getByTestId('edge-label')).toHaveTextContent('pick');
    expect(vi.mocked(ReactFlowLib.getBezierPath)).toHaveBeenCalled();
    expect(screen.getByTestId('mini-map-colors')).toHaveTextContent('#8b5cf6,#f59e0b');
  });

  it('uses onInit instance for zoom and relayout controls', async () => {
    const user = userEvent.setup();
    const rafSpy = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((cb: FrameRequestCallback) => {
        cb(0);
        return 1;
      });

    render(<FlowchartViewer flowNodes={flowNodes} flowEdges={flowEdges} />);

    await user.click(screen.getByRole('button', { name: /Zoom to 100 percent/i }));
    const reactFlowTestUtils = ReactFlowLib as unknown as { __test: { flowApi: { zoomTo: ReturnType<typeof vi.fn>; fitView: ReturnType<typeof vi.fn> } } };
    expect(reactFlowTestUtils.__test.flowApi.zoomTo).toHaveBeenCalledWith(1, { duration: 250 });

    await user.click(screen.getByRole('button', { name: /Re-run auto layout/i }));
    await waitFor(() => {
      expect(reactFlowTestUtils.__test.flowApi.fitView).toHaveBeenCalledWith({ padding: 0.2 });
      expect(rafSpy).toHaveBeenCalled();
    });
  });
});
