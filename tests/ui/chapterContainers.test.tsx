// @vitest-environment jsdom

import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ReactFlowProvider } from "@xyflow/react";
import { ChapterNodeComponent } from "../../src/ui/viewerNodes.tsx";
import { useViewerStore } from "../../src/application/index.ts";

afterEach(() => {
  cleanup();
});

describe("ChapterNodeComponent", () => {
  const baseData = {
    label: "prologue.rpy",
    chapter: "prologue.rpy",
    nodeType: "LABEL" as const,
    chapterNodeCount: 5,
    chapterTotalDialogueCount: 20,
    chapterTotalWordCount: 250,
    chapterTotalPauseDuration: 1.5,
    isChapterContainer: true,
  };

  it("renders expanded container with header badge and collapse button", () => {
    render(
      <ReactFlowProvider>
        <ChapterNodeComponent
          id="chapter:prologue.rpy"
          type="chapterNode"
          data={{
            ...baseData,
            isCollapsed: false,
          }}
          selected={false}
          zIndex={0}
          isConnectable={false}
          positionAbsoluteX={0}
          positionAbsoluteY={0}
          dragging={false}
        />
      </ReactFlowProvider>,
    );

    expect(screen.getByText("prologue.rpy")).toBeInTheDocument();
    expect(screen.getByText(/5 nodes/i)).toBeInTheDocument();
    const collapseBtn = screen.getByRole("button", {
      name: /Collapse chapter container prologue\.rpy/i,
    });
    expect(collapseBtn).toBeInTheDocument();

    // Click collapse button
    fireEvent.click(collapseBtn);
    expect(useViewerStore.getState().collapsedChapters["prologue.rpy"]).toBe(
      true,
    );
  });

  it("renders collapsed summary card with expand button and metrics", () => {
    useViewerStore.setState({
      collapsedChapters: { "prologue.rpy": true },
    });

    render(
      <ReactFlowProvider>
        <ChapterNodeComponent
          id="chapter:prologue.rpy"
          type="chapterNode"
          data={{
            ...baseData,
            isCollapsed: true,
            chapterSearchMatchCount: 3,
          }}
          selected={false}
          zIndex={0}
          isConnectable={false}
          positionAbsoluteX={0}
          positionAbsoluteY={0}
          dragging={false}
        />
      </ReactFlowProvider>,
    );

    expect(screen.getByText(/Chapter Summary/i)).toBeInTheDocument();
    expect(screen.getByText("prologue.rpy")).toBeInTheDocument();
    expect(screen.getByText(/5 labels/i)).toBeInTheDocument();
    expect(screen.getByText(/20 lines/i)).toBeInTheDocument();
    expect(screen.getByText(/3 search matches inside/i)).toBeInTheDocument();

    const expandBtn = screen.getByRole("button", {
      name: /Expand chapter container for prologue\.rpy/i,
    });
    expect(expandBtn).toBeInTheDocument();

    fireEvent.click(expandBtn);
    expect(useViewerStore.getState().collapsedChapters["prologue.rpy"]).toBe(
      false,
    );
  });
});
