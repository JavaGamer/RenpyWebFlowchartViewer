// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import React from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Tokenizer } from "@renpy/ast/out/tokenizer/tokenizer";
import FlowchartViewer from "../../src/ui/FlowchartViewer";
import { parseRenpyFiles } from "../../src/parser/parser";

vi.mock("@xyflow/react", () => {
  const ReactFlow = ({
    nodes,
    edges,
    children,
  }: {
    nodes: Array<{
      id: string;
      type?: string;
      position: { x: number; y: number };
      hidden?: boolean;
      data?: { label?: string; nodeType?: string; dialogueCount?: number };
    }>;
    edges: Array<{
      id: string;
      source: string;
      target: string;
      data?: { label?: string };
    }>;
    children?: React.ReactNode;
  }) => (
    <div data-testid="react-flow">
      <pre data-testid="rendered-graph">
        {JSON.stringify(
          {
            nodes: nodes.map((node) => ({
              id: node.id,
              type: node.type,
              label: node.data?.label,
              nodeType: node.data?.nodeType,
              dialogueCount: node.data?.dialogueCount,
              hidden: Boolean(node.hidden),
              position: {
                x: Math.round(node.position.x),
                y: Math.round(node.position.y),
              },
            })),
            edges: edges.map((edge) => ({
              id: edge.id,
              source: edge.source,
              target: edge.target,
              label: edge.data?.label,
            })),
          },
          null,
          2,
        )}
      </pre>
      {children}
    </div>
  );

  const Background = () => null;
  const Controls = () => null;
  const MiniMap = () => null;
  const Handle = () => null;
  const BaseEdge = () => null;
  const EdgeLabelRenderer = ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  );
  const getBezierPath = () => ["M 0 0", 0, 0] as [string, number, number];
  const Position = {
    Top: "top",
    Bottom: "bottom",
    Left: "left",
    Right: "right",
  };
  const MarkerType = { ArrowClosed: "arrowclosed" };
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
  };
});

function loadFixture(name: string): string {
  const fixturesDir = resolve(import.meta.dirname, "../fixtures");
  return readFileSync(resolve(fixturesDir, name), "utf8");
}

async function renderParsedGraph(script: string) {
  const parsed = await parseRenpyFiles([{
    name: "graph.rpy",
    content: script,
  }]);
  const { container } = render(
    <FlowchartViewer flowNodes={parsed.nodes} flowEdges={parsed.edges} />,
  );
  return container.querySelector('[data-testid="rendered-graph"]')?.textContent;
}

describe("FlowchartViewer rendered graph snapshots", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Tokenizer.clearTokenCache();
  });

  afterEach(() => {
    cleanup();
  });

  it("matches snapshot for a linear graph", async () => {
    const script = [
      "label start:",
      '    "Welcome"',
      "",
      "label second:",
      '    e "Hi"',
      "",
    ].join("\n");

    await expect(renderParsedGraph(script)).resolves.toMatchSnapshot();
  });

  it("matches snapshot for branching menu graph", async () => {
    const script = [
      "label choice:",
      "    menu:",
      '        "Option A":',
      "            jump end_a",
      '        "Option B":',
      "            jump end_b",
      "",
      "label end_a:",
      '    "done a"',
      "",
      "label end_b:",
      '    "done b"',
      "",
    ].join("\n");

    await expect(renderParsedGraph(script)).resolves.toMatchSnapshot();
  });

  it("matches snapshot for cyclic jumps fixture graph", async () => {
    const fixtureScript = loadFixture("cyclic-jumps.rpy");
    await expect(renderParsedGraph(fixtureScript)).resolves.toMatchSnapshot();
  });
});
