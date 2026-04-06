// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import FlowchartViewer from '../src/FlowchartViewer';
import type { FlowNode, FlowEdge } from '../src/domain/graph';
import * as ReactFlowLib from '@xyflow/react';
import type { ParseService } from '../src/application/parseService';

vi.mock('@xyflow/react', () => {
  const flowApi = { zoomTo: vi.fn(), fitView: vi.fn(), setCenter: vi.fn() };

  const ReactFlow = ({
    nodes,
    edges,
    nodeTypes,
    edgeTypes,
    onInit,
    onNodeClick,
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
    onNodeClick?: (event: unknown, node: { id: string }) => void;
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
            <button
              key={n.id}
              type="button"
              aria-label={`node-${n.id}`}
              onClick={() => onNodeClick?.({}, { id: n.id })}
            >
              <NodeComp
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
            </button>
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
      dialogueLines: ['hello world', 'another line'],
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

  it('does not crash when localStorage access throws', () => {
    const localStorageMock = {
      getItem: vi.fn(() => {
        throw new DOMException('Blocked', 'SecurityError');
      }),
      setItem: vi.fn(() => {
        throw new DOMException('Blocked', 'SecurityError');
      }),
      removeItem: vi.fn(),
      clear: vi.fn(),
      key: vi.fn(),
      length: 0,
    } as unknown as Storage;
    vi.stubGlobal('localStorage', localStorageMock);

    expect(() => render(<FlowchartViewer flowNodes={flowNodes} flowEdges={flowEdges} />)).not.toThrow();
    expect(screen.getByTestId('react-flow')).toBeInTheDocument();
  });



  it('supports focus label center action, edge-type toggles, and keyboard shortcuts', async () => {
    const user = userEvent.setup();
    render(<FlowchartViewer flowNodes={flowNodes} flowEdges={flowEdges} />);

    await user.click(screen.getByRole('button', { name: /Show advanced controls/i }));
    const edgeToggle = screen.getByRole('checkbox', { name: /Show sequence edges/i });
    expect(edgeToggle).toBeChecked();
    await user.click(edgeToggle);
    expect(edgeToggle).not.toBeChecked();

    await user.selectOptions(screen.getByRole('combobox', { name: /Focus label/i }), 'start');
    await user.click(screen.getByRole('button', { name: /Center selected label/i }));

    const reactFlowTestUtils = ReactFlowLib as unknown as {
      __test: {
        flowApi: {
          zoomTo: ReturnType<typeof vi.fn>;
          fitView: ReturnType<typeof vi.fn>;
          setCenter: ReturnType<typeof vi.fn>;
        };
      };
    };

    expect(reactFlowTestUtils.__test.flowApi.setCenter).toHaveBeenCalled();

    fireEvent.keyDown(window, { key: 'f', ctrlKey: true });
    expect(
      screen.getByRole('textbox', {
        name: /Search/i,
      }),
    ).toHaveFocus();

    fireEvent.keyDown(window, { key: 'l', ctrlKey: true });
    expect(reactFlowTestUtils.__test.flowApi.fitView).toHaveBeenCalledWith({ padding: 0.2 });

    expect(screen.getByText(/Shortcuts: Ctrl\/Cmd\+F search/i)).toBeInTheDocument();
    expect(screen.getByRole('toolbar', { name: /Viewer controls/i })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: /Primary controls/i })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: /Search and filters/i })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: /Layout and focus controls/i })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: /Export controls/i })).toBeInTheDocument();
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

    await user.click(screen.getByRole('button', { name: /Show advanced controls/i }));
    await user.click(screen.getByRole('button', { name: /Re-run auto layout/i }));
    await waitFor(() => {
      expect(reactFlowTestUtils.__test.flowApi.fitView).toHaveBeenCalledWith({ padding: 0.2 });
      expect(rafSpy).toHaveBeenCalled();
    });
  });

  it('shows inspector with truncated dialogue lines and clickable dialogue search results', async () => {
    const user = userEvent.setup();
    const extendedNode: FlowNode[] = [
      {
        id: 'start',
        type: 'LABEL',
        label: 'start',
        dialogueCount: 22,
        dialogueLines: Array.from({ length: 22 }, (_, i) =>
          i === 20 ? 'special needle line' : `line ${i + 1}`,
        ),
        chapter: 'chapter1',
      },
    ];
    render(<FlowchartViewer flowNodes={extendedNode} flowEdges={[]} />);

    await user.click(screen.getByRole('button', { name: /node-start/i }));
    expect(screen.getByLabelText(/Inspector panel/i)).toBeInTheDocument();
    expect(screen.getByText(/Dialogue lines:/i).parentElement).toHaveTextContent('Dialogue lines: 22');
    expect(screen.getByText('20.')).toBeInTheDocument();
    expect(screen.queryByText('21.')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Show more/i }));
    expect(screen.getByText('21.')).toBeInTheDocument();

    const search = screen.getByRole('textbox', {
      name: /Search/i,
    });
    await user.clear(search);
    await user.type(search, 'needle');
    expect(await screen.findByText(/Dialogue line matches \(1\)/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /line 21/i }));
    expect(screen.getByText('21.')).toBeInTheDocument();
    const highlightedResult = screen.getByRole('button', { name: /line 21/i });
    expect(within(highlightedResult).getByText('needle', { selector: 'mark' })).toBeInTheDocument();
    const inspector = screen.getByLabelText(/Inspector panel/i);
    const inspectorNeedleMark = within(inspector).getAllByText('needle', { selector: 'mark' });
    expect(inspectorNeedleMark.length).toBe(2);
  });

  it('supports keyboard navigation for dialogue search results and empty-state guidance', async () => {
    const user = userEvent.setup();
    const keyboardNode: FlowNode[] = [
      {
        id: 'start',
        type: 'LABEL',
        label: 'start',
        dialogueCount: 22,
        dialogueLines: Array.from({ length: 22 }, (_, i) =>
          i === 0 || i === 20 ? `needle line ${i + 1}` : `line ${i + 1}`,
        ),
        chapter: 'chapter1',
      },
    ];
    render(<FlowchartViewer flowNodes={keyboardNode} flowEdges={[]} />);

    const search = screen.getByRole('textbox', {
      name: /Search/i,
    });

    await user.type(search, 'needle');
    expect(await screen.findByText(/Dialogue line matches \(2\)/i)).toBeInTheDocument();
    expect(screen.getByText(/use ↑\/↓ to move results and Enter to open/i)).toBeInTheDocument();

    fireEvent.keyDown(search, { key: 'ArrowDown' });
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(screen.getByText('21.')).toBeInTheDocument();

    await user.clear(search);
    await user.type(search, 'missing');
    expect(await screen.findByText(/No dialogue lines matched “missing”/i)).toBeInTheDocument();
  });

  it('supports performance dialogue search mode with label/count-only matching', async () => {
    const user = userEvent.setup();
    render(<FlowchartViewer flowNodes={flowNodes} flowEdges={flowEdges} />);

    await user.selectOptions(screen.getByRole('combobox', { name: /Dialogue search mode/i }), 'countOnly');
    expect(screen.getByText(/Dialogue line search is disabled in performance mode/i)).toBeInTheDocument();

    const search = screen.getByRole('textbox', { name: /Search/i });
    await user.type(search, 'hello');
    expect(screen.getByText(/Dialogue line matching is unavailable in performance mode/i)).toBeInTheDocument();
  });

  it('uses worker-backed dialogue search for large graph mode', async () => {
    const user = userEvent.setup();
    const largeNodes: FlowNode[] = Array.from({ length: 181 }, (_, i) => ({
      id: `label_${i}`,
      type: 'LABEL',
      label: `label_${i}`,
      dialogueCount: 1,
      dialogueLines: [`line ${i}`],
      chapter: 'chapter1',
    }));
    const searchDialogueLines = vi.fn().mockResolvedValue([
      { nodeId: 'label_10', nodeLabel: 'label_10', lineIndex: 1, lineText: 'needle line' },
    ]);
    const parseService: ParseService = {
      parse: vi.fn(),
      searchDialogueLines,
    };

    render(<FlowchartViewer flowNodes={largeNodes} flowEdges={[]} parseService={parseService} />);
    await user.selectOptions(screen.getByRole('combobox', { name: /Dialogue search mode/i }), 'full');
    const search = screen.getByRole('textbox', { name: /Search/i });
    await user.type(search, 'needle');

    await waitFor(() => {
      expect(searchDialogueLines).toHaveBeenCalled();
    });
    expect(await screen.findByText(/Dialogue line matches \(1\)/i)).toBeInTheDocument();
  });

  it('keeps inspector in the document flow and includes focus-visible affordance classes', async () => {
    const user = userEvent.setup();
    render(<FlowchartViewer flowNodes={flowNodes} flowEdges={flowEdges} />);

    await user.click(screen.getByRole('button', { name: /node-start/i }));
    const inspector = screen.getByLabelText(/Inspector panel/i);
    expect(inspector.className).toContain('w-full');
    expect(inspector.className).toContain('xl:w-96');

    const exportPng = screen.getByRole('button', { name: /Export flowchart as PNG/i });
    expect(exportPng.className).toContain('focus-visible:ring-2');
  });

  it('keeps node match count aligned with current visibility filters', async () => {
    const user = userEvent.setup();
    render(<FlowchartViewer flowNodes={flowNodes} flowEdges={flowEdges} />);

    const search = screen.getByRole('textbox', { name: /Search/i });
    await user.type(search, 'start');
    expect(screen.getByText(/Node matches \(label\/count\): 1/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Show advanced controls/i }));
    await user.click(screen.getByRole('button', { name: /Collapse chapter chapter1/i }));
    expect(screen.getByText(/Node matches \(label\/count\): 0/i)).toBeInTheDocument();
  });

  it('keeps label toggle control available for show more and show fewer states', async () => {
    const user = userEvent.setup();
    const manyLabels: FlowNode[] = Array.from({ length: 30 }, (_, i) => ({
      id: `label_${i + 1}`,
      type: 'LABEL',
      label: `label_${i + 1}`,
      dialogueCount: 1,
      chapter: 'chapter1',
    }));

    render(<FlowchartViewer flowNodes={manyLabels} flowEdges={[]} />);
    await user.click(screen.getByRole('button', { name: /Show advanced controls/i }));

    const showMore = screen.getByRole('button', { name: /Show 6 more label subgraph toggles/i });
    expect(showMore).toBeInTheDocument();
    await user.click(showMore);
    expect(screen.getByRole('button', { name: /Show fewer label subgraph toggles/i })).toBeInTheDocument();
  });
});
