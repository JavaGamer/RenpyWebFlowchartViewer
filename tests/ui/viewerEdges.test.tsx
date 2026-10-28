// @vitest-environment jsdom

import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Position } from "@xyflow/react";
import { LabeledEdge } from "../../src/ui/viewerEdges.tsx";

afterEach(cleanup);

describe("LabeledEdge and Choice Bubbles", () => {
  it("renders choice bubble with zIndex above edge lines and without transition-all", () => {
    render(
      <LabeledEdge
        id="edge_1"
        source="menu_node"
        target="label_node"
        sourceX={100}
        sourceY={100}
        targetX={100}
        targetY={200}
        sourcePosition={Position.Bottom}
        targetPosition={Position.Top}
        selected={false}
        data={{
          displayLabel: "Choice 1: Go left",
          label: "Choice 1: Go left",
        }}
      />,
    );

    const bubble = screen.getByText("Choice 1: Go left");
    expect(bubble).toBeInTheDocument();

    // Must be styled with zIndex above SVG edges (which default to 0 or 1 in React Flow)
    expect(bubble.style.zIndex).toBe("10");
    expect(bubble.className).toContain("z-10");

    // Must use transition-colors instead of transition-all so transform isn't delayed during drag
    expect(bubble.className).toContain("transition-colors");
    expect(bubble.className).not.toContain("transition-all");
  });

  it("elevates choice bubble zIndex higher when edge is selected", () => {
    render(
      <LabeledEdge
        id="edge_selected"
        source="menu_node"
        target="label_node"
        sourceX={100}
        sourceY={100}
        targetX={100}
        targetY={200}
        sourcePosition={Position.Bottom}
        targetPosition={Position.Top}
        selected={true}
        data={{
          displayLabel: "Selected Option",
          label: "Selected Option",
        }}
      />,
    );

    const bubble = screen.getByText("Selected Option");
    expect(bubble).toBeInTheDocument();
    // In React Flow, selected edges elevate to 1000/1001, so label must be > 1000
    expect(bubble.style.zIndex).toBe("1005");
  });

  it("updates choice bubble position live when endpoints move together during chapter dragging", () => {
    // Initial layout coordinates: source was at (100, 100), target at (100, 250)
    // with precomputed label at (100, 175)
    const bendPoints = [
      { x: 100, y: 100 },
      { x: 100, y: 250 },
    ];
    const initialLabelPosition = { x: 100, y: 175 };

    // Now chapter node is dragged by dx = +40, dy = +50 (within old 84px deadzone)
    const { rerender } = render(
      <LabeledEdge
        id="edge_ch"
        source="menu_node"
        target="choice_target"
        sourceX={100}
        sourceY={100}
        targetX={100}
        targetY={250}
        sourcePosition={Position.Bottom}
        targetPosition={Position.Top}
        selected={false}
        data={{
          displayLabel: "Menu Choice A",
          label: "Menu Choice A",
          bendPoints,
          labelPosition: initialLabelPosition,
          svgPath: "M 100 100 L 100 250",
        }}
      />,
    );

    const initialBubble = screen.getByText("Menu Choice A");
    expect(initialBubble.style.transform).toContain("translate(100px,175px)");

    // Simulate moving the chapter container: handles shift to (140, 150) and (140, 300)
    rerender(
      <LabeledEdge
        id="edge_ch"
        source="menu_node"
        target="choice_target"
        sourceX={140}
        sourceY={150}
        targetX={140}
        targetY={300}
        sourcePosition={Position.Bottom}
        targetPosition={Position.Top}
        selected={false}
        data={{
          displayLabel: "Menu Choice A",
          label: "Menu Choice A",
          bendPoints,
          labelPosition: initialLabelPosition,
          svgPath: "M 100 100 L 100 250",
        }}
      />,
    );

    const movedBubble = screen.getByText("Menu Choice A");
    // Choice bubble must translate live with the chapter displacement (100 + 40 = 140, 175 + 50 = 225)
    expect(movedBubble.style.transform).toContain("translate(140px,225px)");
  });

  it("updates parallel menu choice edges live during node/chapter dragging", () => {
    // Parallel choice edge with parallelCount = 2, index = 0
    const { rerender } = render(
      <LabeledEdge
        id="menu_choice_0"
        source="menu_1"
        target="target_1"
        sourceX={200}
        sourceY={100}
        targetX={200}
        targetY={300}
        sourcePosition={Position.Bottom}
        targetPosition={Position.Top}
        selected={false}
        data={{
          displayLabel: "Choice Option 1",
          label: "Choice Option 1",
          parallelCount: 2,
          parallelIndex: 0,
        }}
      />,
    );

    const initialBubble = screen.getByText("Choice Option 1");
    // Initial midY is (100 + 300)/2 = 200 (staggered slightly by parallel spline)
    expect(initialBubble).toBeInTheDocument();

    // Drag chapter container by dy = 60, dx = 30
    rerender(
      <LabeledEdge
        id="menu_choice_0"
        source="menu_1"
        target="target_1"
        sourceX={230}
        sourceY={160}
        targetX={230}
        targetY={360}
        sourcePosition={Position.Bottom}
        targetPosition={Position.Top}
        selected={false}
        data={{
          displayLabel: "Choice Option 1",
          label: "Choice Option 1",
          parallelCount: 2,
          parallelIndex: 0,
        }}
      />,
    );

    const movedBubble = screen.getByText("Choice Option 1");
    // Parallel forward spline must recalculate live with new coordinates immediately
    expect(movedBubble.style.transform).not.toContain("translate(200px,");
    expect(movedBubble.style.transform).toContain("translate(");
  });
});
