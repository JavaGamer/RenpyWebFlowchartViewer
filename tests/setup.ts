import * as matchers from "@testing-library/jest-dom/matchers";
import { cleanup } from "@testing-library/react";
import { afterEach, expect } from "vitest";
expect.extend(matchers);

afterEach(() => {
  cleanup();
});

// Ensure React's act() integration is enabled in the Vitest + jsdom environment.
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

// Polyfill Deno's node:worker_threads missing parentPort.removeAllListeners
import * as workerThreads from "node:worker_threads";
if (workerThreads.parentPort) {
  workerThreads.parentPort.removeAllListeners = () => workerThreads.parentPort!;
}

function patchDispatch(
  proto: { dispatchEvent: typeof EventTarget.prototype.dispatchEvent },
) {
  if ((proto as unknown as { __isPatched?: boolean }).__isPatched) return;
  (proto as unknown as { __isPatched?: boolean }).__isPatched = true;
  const orig = proto.dispatchEvent;
  if (!orig) return;
  proto.dispatchEvent = function (event: Event) {
    try {
      return orig.call(this, event);
    } catch (err: unknown) {
      const msg = String((err as { message?: string })?.message || err);
      if (
        msg.includes("not of type 'Event'") &&
        event &&
        typeof (event as unknown as { type: string }).type === "string"
      ) {
        const nativeEvent = new Event(
          (event as unknown as { type: string }).type,
          {
            bubbles: event.bubbles,
            cancelable: event.cancelable,
            composed: event.composed,
          },
        );
        for (const prop of Object.getOwnPropertyNames(event)) {
          try {
            (nativeEvent as unknown as Record<string, unknown>)[prop] =
              (event as unknown as Record<string, unknown>)[prop];
          } catch {
            // ignore read-only properties
          }
        }
        return orig.call(this, nativeEvent);
      }
      throw err;
    }
  };
}

if (
  typeof window !== "undefined" &&
  typeof (window as unknown as { EventTarget?: typeof EventTarget })
      .EventTarget !== "undefined"
) {
  const winEventTarget =
    (window as unknown as { EventTarget: typeof EventTarget }).EventTarget;
  if (winEventTarget && winEventTarget.prototype) {
    patchDispatch(winEventTarget.prototype);
  }
}

import React from "react";
import { vi } from "vitest";

vi.mock("@xyflow/react", () => {
  const flowApi = {
    zoomTo: vi.fn(),
    fitView: vi.fn(),
    setCenter: vi.fn(),
    shouldThrow: false,
  };

  const ReactFlow = ({
    nodes = [],
    edges = [],
    nodeTypes,
    edgeTypes,
    onInit,
    onNodeClick,
    children,
  }: {
    nodes?: Array<{
      id: string;
      type?: string;
      position?: { x: number; y: number };
      hidden?: boolean;
      data?: { label?: string; nodeType?: string; dialogueCount?: number };
    }>;
    edges?: Array<{
      id: string;
      source: string;
      target: string;
      data?: { label?: string };
      label?: string;
      style?: Record<string, unknown>;
    }>;
    nodeTypes?: Record<string, React.ComponentType<unknown>>;
    edgeTypes?: Record<string, React.ComponentType<unknown>>;
    onInit?: (instance: unknown) => void;
    onNodeClick?: (event: unknown, node: { id: string }) => void;
    children?: React.ReactNode;
  }) => {
    if (flowApi.shouldThrow) throw new Error("canvas render error");
    React.useEffect(() => {
      onInit?.(flowApi);
    }, [onInit]);
    return React.createElement(
      "div",
      { "data-testid": "react-flow" },
      React.createElement(
        "span",
        { "data-testid": "rf-node-count" },
        String(nodes.filter((n) => !n.hidden).length),
      ),
      React.createElement(
        "span",
        { "data-testid": "rf-edge-count" },
        String(edges.length),
      ),
      React.createElement(
        "pre",
        { "data-testid": "rendered-graph" },
        JSON.stringify(
          {
            nodes: nodes.map((node) => ({
              id: node.id,
              type: node.type,
              label: node.data?.label,
              nodeType: node.data?.nodeType,
              dialogueCount: node.data?.dialogueCount,
              hidden: Boolean(node.hidden),
              position: {
                x: Math.round(node.position?.x ?? 0),
                y: Math.round(node.position?.y ?? 0),
              },
            })),
            edges: edges.map((edge) => ({
              id: edge.id,
              source: edge.source,
              target: edge.target,
              label: edge.data?.label ?? edge.label ?? "",
            })),
          },
          null,
          2,
        ),
      ),
      nodes.map((n) => {
        const NodeComp = n.type && nodeTypes ? nodeTypes[n.type] : null;
        return NodeComp
          ? React.createElement(
            "button",
            {
              key: n.id,
              type: "button",
              "aria-label": `node-${n.id}`,
              onClick: () => onNodeClick?.({}, { id: n.id }),
            },
            React.createElement(NodeComp, {
              id: n.id,
              data: n.data,
              selected: false,
              dragging: false,
              isConnectable: true,
              xPos: n.position?.x ?? 0,
              yPos: n.position?.y ?? 0,
              zIndex: 0,
              type: n.type,
            }),
          )
          : null;
      }),
      edges.map((e) => {
        const EdgeComp = edgeTypes?.labeled;
        return EdgeComp
          ? React.createElement(EdgeComp, {
            key: e.id,
            id: e.id,
            sourceX: 0,
            sourceY: 0,
            targetX: 10,
            targetY: 10,
            sourcePosition: "bottom",
            targetPosition: "top",
            markerEnd: "arrow",
            style: e.style,
            data: e.data,
          })
          : null;
      }),
      children,
    );
  };

  const Background = () => null;
  const Controls = () => null;
  const MiniMap = ({
    nodeColor,
  }: {
    nodeColor?: (node: { type?: string }) => string;
  }) =>
    React.createElement(
      "div",
      { "data-testid": "mini-map-colors" },
      [nodeColor?.({ type: "labelNode" }), nodeColor?.({ type: "menuNode" })]
        .filter((v): v is string => Boolean(v))
        .join(","),
    );
  const Handle = () => null;
  const BaseEdge = ({ id, path }: { id: string; path: string }) =>
    React.createElement("div", { "data-testid": `base-edge-${id}` }, path);
  const EdgeLabelRenderer = ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", { "data-testid": "edge-label" }, children);
  const getBezierPath = vi.fn(() =>
    ["M 1 1", 10, 20] as [string, number, number]
  );
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
    __test: { flowApi },
  };
});
