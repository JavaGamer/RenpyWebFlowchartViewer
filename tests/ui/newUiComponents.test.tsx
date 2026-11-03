// @vitest-environment jsdom

import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import * as Tooltip from "@radix-ui/react-tooltip";
import { LeftSidebar } from "../../src/ui/LeftSidebar.tsx";
import { ViewerInspector } from "../../src/ui/viewerInspector.tsx";
import { CanvasHud } from "../../src/ui/components/CanvasHud.tsx";
import { SearchControls } from "../../src/ui/components/SearchControls.tsx";
import { UtilityStatusBar } from "../../src/ui/UtilityStatusBar.tsx";
import { CanvasErrorFallback } from "../../src/ui/CanvasErrorFallback.tsx";
import TelemetryModal from "../../src/ui/TelemetryModal.tsx";
import { useViewerStore } from "../../src/application/index.ts";

afterEach(cleanup);

beforeEach(() => {
  useViewerStore.setState({
    theme: "violet",
    isLeftSidebarOpen: true,
    isRightDockOpen: true,
    layoutDirection: "TB",
    showPacingHeatmap: false,
    selectedNodeId: "",
    selectedSearchChapter: "",
    selectedSearchNodeKinds: {
      LABEL: true,
      MENU: true,
      DECISION: true,
    },
  });
});

describe("New UI Implementation Tests", () => {
  describe("LeftSidebar", () => {
    it("renders chapters and story labels, triggers onFocusNode when clicked", () => {
      const onFocusNode = vi.fn();
      render(
        <LeftSidebar
          chapters={["Prologue", "Chapter 1"]}
          labels={["start", "scene1", "ending"]}
          onFocusNode={onFocusNode}
        />,
      );

      // Verify Chapters exist
      expect(screen.getByText("Chapters (2)")).toBeInTheDocument();
      const ch1Btn = screen.getByText("Prologue");
      fireEvent.click(ch1Btn);

      expect(onFocusNode).toHaveBeenCalledWith("Prologue");
      expect(useViewerStore.getState().selectedSearchChapter).toBe("Prologue");

      // Verify Labels exist and clicking triggers onFocusNode and selection
      expect(screen.getByText("Story Labels (3)")).toBeInTheDocument();
      const startLblBtn = screen.getByText("start");
      fireEvent.click(startLblBtn);

      expect(onFocusNode).toHaveBeenCalledWith("start");
      expect(useViewerStore.getState().selectedNodeId).toBe("start");
    });

    it("supports toggling node kinds in LeftSidebar", () => {
      render(
        <LeftSidebar
          chapters={[]}
          labels={["start"]}
        />,
      );

      const menuCheckbox = screen.getByLabelText(/Branch choices/i);
      fireEvent.click(menuCheckbox);
      expect(useViewerStore.getState().selectedSearchNodeKinds.MENU).toBe(
        false,
      );

      fireEvent.click(menuCheckbox);
      expect(useViewerStore.getState().selectedSearchNodeKinds.MENU).toBe(true);
    });

    it("handles subgraph collapse all / expand all actions", () => {
      const setAllVisibleSubgraphLabelsCollapsed = vi.fn();
      render(
        <LeftSidebar
          chapters={[]}
          labels={["sub1", "sub2"]}
          visibleSubgraphLabels={["sub1"]}
          collapsedLabelCount={1}
          setAllVisibleSubgraphLabelsCollapsed={setAllVisibleSubgraphLabelsCollapsed}
        />,
      );

      const collapseAllBtn = screen.getByRole("button", {
        name: /collapse all/i,
      });
      fireEvent.click(collapseAllBtn);
      expect(setAllVisibleSubgraphLabelsCollapsed).toHaveBeenCalledWith(true);

      const expandAllBtn = screen.getByRole("button", { name: /expand all/i });
      fireEvent.click(expandAllBtn);
      expect(setAllVisibleSubgraphLabelsCollapsed).toHaveBeenCalledWith(false);
    });

    it("closes left sidebar when close button is clicked", () => {
      render(
        <LeftSidebar
          chapters={["Prologue"]}
          labels={[]}
        />,
      );

      const closeBtn = screen.getByRole("button", {
        name: /close left sidebar/i,
      });
      fireEvent.click(closeBtn);
      expect(useViewerStore.getState().isLeftSidebarOpen).toBe(false);
    });

    it("manages accordion aria-expanded states and label filter with clear", () => {
      render(
        <LeftSidebar
          chapters={["Prologue"]}
          labels={[
            "label1",
            "label2",
            "label3",
            "label4",
            "label5",
            "label6",
            "label7",
            "label8",
            "label9",
            "target_lbl",
          ]}
        />,
      );

      const chBtn = screen.getByRole("button", { name: /chapters \(1\)/i });
      expect(chBtn).toHaveAttribute("aria-expanded", "true");
      fireEvent.click(chBtn);
      expect(chBtn).toHaveAttribute("aria-expanded", "false");

      const filterInput = screen.getByRole("textbox", {
        name: /filter labels/i,
      });
      fireEvent.change(filterInput, { target: { value: "target" } });
      expect(screen.getByText("target_lbl")).toBeInTheDocument();
      expect(screen.queryByText("label1")).not.toBeInTheDocument();

      const clearBtn = screen.getByRole("button", {
        name: /clear label filter/i,
      });
      fireEvent.click(clearBtn);
      expect(screen.getByText("label1")).toBeInTheDocument();
    });
  });

  describe("ViewerInspector", () => {
    it("renders when isRightDockOpen is true, hides when isRightDockOpen is false", () => {
      const { rerender } = render(
        <ViewerInspector
          effectiveSearch=""
          nodeSearchMatchCount={0}
          dialogueLineSearchEnabled={true}
          activeDialogueSearchResults={[]}
          resolvedActiveDialogueResultIndex={-1}
          selectedNode={null}
          selectedNodeData={undefined}
          selectedNodeId=""
          selectedDialogueLineIndex={null}
          showAllInspectorLines={false}
          showMediaCuesInDialogue={false}
          setShowMediaCuesInDialogue={vi.fn()}
          onToggleShowAllInspectorLines={vi.fn()}
          onSetActiveDialogueResultIndex={vi.fn()}
          onSelectDialogueSearchResult={vi.fn()}
        />,
      );

      expect(screen.getByLabelText("Inspector panel")).toBeInTheDocument();

      // Close right dock via close button
      const closeBtn = screen.getByRole("button", {
        name: /^close inspector$/i,
      });
      fireEvent.click(closeBtn);
      expect(useViewerStore.getState().isRightDockOpen).toBe(false);

      // Re-render, inspector should now return null
      rerender(
        <ViewerInspector
          effectiveSearch=""
          nodeSearchMatchCount={0}
          dialogueLineSearchEnabled={true}
          activeDialogueSearchResults={[]}
          resolvedActiveDialogueResultIndex={-1}
          selectedNode={null}
          selectedNodeData={undefined}
          selectedNodeId=""
          selectedDialogueLineIndex={null}
          showAllInspectorLines={false}
          showMediaCuesInDialogue={false}
          setShowMediaCuesInDialogue={vi.fn()}
          onToggleShowAllInspectorLines={vi.fn()}
          onSetActiveDialogueResultIndex={vi.fn()}
          onSelectDialogueSearchResult={vi.fn()}
        />,
      );

      expect(screen.queryByLabelText("Inspector panel")).not
        .toBeInTheDocument();
    });
  });

  describe("CanvasHud", () => {
    it("triggers zoom and fit view actions", () => {
      const onFitView = vi.fn();
      const zoomIn = vi.fn();
      const zoomOut = vi.fn();
      const flowInstanceRef = {
        current: { zoomIn, zoomOut, fitView: vi.fn() },
      };

      render(
        <CanvasHud
          onFitView={onFitView}
          flowInstanceRef={flowInstanceRef}
        />,
      );

      const zoomInBtn = screen.getByRole("button", { name: /zoom in/i });
      fireEvent.click(zoomInBtn);
      expect(zoomIn).toHaveBeenCalledWith({ duration: 200 });

      const zoomOutBtn = screen.getByRole("button", { name: /zoom out/i });
      fireEvent.click(zoomOutBtn);
      expect(zoomOut).toHaveBeenCalledWith({ duration: 200 });

      const fitBtn = screen.getByRole("button", {
        name: /canvas fit to view/i,
      });
      fireEvent.click(fitBtn);
      expect(onFitView).toHaveBeenCalledTimes(1);
    });

    it("toggles layout direction and pacing heatmap", () => {
      render(<CanvasHud />);

      const lrBtn = screen.getByRole("button", {
        name: /left to right layout/i,
      });
      const tbBtn = screen.getByRole("button", {
        name: /top to bottom layout/i,
      });

      expect(tbBtn).toHaveAttribute("aria-pressed", "true");
      expect(lrBtn).toHaveAttribute("aria-pressed", "false");

      fireEvent.click(lrBtn);
      expect(useViewerStore.getState().layoutDirection).toBe("LR");
      expect(lrBtn).toHaveAttribute("aria-pressed", "true");
      expect(tbBtn).toHaveAttribute("aria-pressed", "false");

      fireEvent.click(tbBtn);
      expect(useViewerStore.getState().layoutDirection).toBe("TB");

      const heatmapCheckbox = screen.getByLabelText(/toggle pacing heatmap/i);
      fireEvent.click(heatmapCheckbox);
      expect(useViewerStore.getState().showPacingHeatmap).toBe(true);
    });
  });

  describe("SearchControls", () => {
    it("opens filter popover, dismisses on Escape or outside click", () => {
      const setSearchInput = vi.fn();
      const searchInputRef = { current: null };
      const onSearchInputKeyDown = vi.fn();
      const setSelectedSearchChapter = vi.fn();
      const setSelectedSearchNodeKinds = vi.fn();

      render(
        <Tooltip.Provider>
          <div>
            <div data-testid="outside-area">Outside</div>
            <SearchControls
              isDark={false}
              searchInput="test"
              setSearchInput={setSearchInput}
              searchInputRef={searchInputRef}
              onSearchInputKeyDown={onSearchInputKeyDown}
              dialogueLineSearchEnabled={true}
              selectedSearchChapter=""
              setSelectedSearchChapter={setSelectedSearchChapter}
              selectedSearchNodeKinds={{
                LABEL: true,
                MENU: true,
                DECISION: true,
              }}
              setSelectedSearchNodeKinds={setSelectedSearchNodeKinds}
              uniqueChapters={["Ch1", "Ch2"]}
            />
          </div>
        </Tooltip.Provider>,
      );

      const filterToggleBtn = screen.getByRole("button", {
        name: /toggle search filters/i,
      });
      expect(filterToggleBtn).toHaveClass("relative");

      // Open popover
      fireEvent.click(filterToggleBtn);
      expect(screen.getByText("Chapter Scope:")).toBeInTheDocument();

      // Press Escape to dismiss
      fireEvent.keyDown(document, { key: "Escape" });
      expect(screen.queryByText("Chapter Scope:")).not.toBeInTheDocument();

      // Open again and click outside to dismiss
      fireEvent.click(filterToggleBtn);
      expect(screen.getByText("Chapter Scope:")).toBeInTheDocument();

      fireEvent.pointerDown(screen.getByTestId("outside-area"));
      expect(screen.queryByText("Chapter Scope:")).not.toBeInTheDocument();
    });

    it("clears search input when clear button is clicked or Escape is pressed", () => {
      const setSearchInput = vi.fn();
      const inputRef = {
        current: null,
      };
      const focusSpy = vi.spyOn(HTMLInputElement.prototype, "focus");

      render(
        <Tooltip.Provider>
          <SearchControls
            isDark={false}
            searchInput="my query"
            setSearchInput={setSearchInput}
            searchInputRef={inputRef}
            onSearchInputKeyDown={vi.fn()}
            dialogueLineSearchEnabled={true}
            selectedSearchChapter=""
            setSelectedSearchChapter={vi.fn()}
            selectedSearchNodeKinds={{
              LABEL: true,
              MENU: true,
              DECISION: true,
            }}
            setSelectedSearchNodeKinds={vi.fn()}
            uniqueChapters={[]}
          />
        </Tooltip.Provider>,
      );

      // Verify clear button appears when searchInput is not empty
      const clearBtn = screen.getByRole("button", { name: /clear search/i });
      fireEvent.click(clearBtn);

      expect(setSearchInput).toHaveBeenCalledWith("");
      expect(focusSpy).toHaveBeenCalled();
      focusSpy.mockRestore();

      // Test Escape key inside input
      const input = screen.getByRole("textbox", { name: /search/i });
      fireEvent.keyDown(input, { key: "Escape" });
      expect(setSearchInput).toHaveBeenCalledWith("");
    });
  });

  describe("CanvasErrorFallback", () => {
    it("renders error message and allows trying again", () => {
      const reset = vi.fn();
      render(
        <CanvasErrorFallback
          error={new Error("Canvas layout failed")}
          resetErrorBoundary={reset}
        />,
      );

      expect(screen.getByRole("alert")).toBeInTheDocument();
      expect(screen.getByText("Canvas layout failed")).toBeInTheDocument();

      const tryAgainBtn = screen.getByRole("button", { name: /try again/i });
      fireEvent.click(tryAgainBtn);
      expect(reset).toHaveBeenCalledTimes(1);
    });
  });

  describe("TelemetryModal", () => {
    it("renders modal with light and dark mode support", () => {
      const onClose = vi.fn();
      useViewerStore.setState({ theme: "violet" });
      const { rerender } = render(
        <TelemetryModal open={true} onClose={onClose} />,
      );

      expect(screen.getByText("Performance Telemetry")).toBeInTheDocument();
      expect(
        screen.getByText(/Metrics are captured when debug perf is enabled/i),
      ).toBeInTheDocument();

      act(() => {
        useViewerStore.setState({ theme: "dark" });
      });
      rerender(<TelemetryModal open={true} onClose={onClose} />);
      expect(screen.getByText("Performance Telemetry")).toBeInTheDocument();
    });
  });

  describe("UtilityStatusBar", () => {
    it("renders node/edge counts, reading time, and layout engine", () => {
      render(
        <UtilityStatusBar
          visibleNodeCount={10}
          totalNodeCount={20}
          visibleEdgeCount={12}
          totalEdgeCount={25}
          visibleWordCount={500}
          visiblePauseDuration={2}
          totalWordCount={1200}
          totalPauseDuration={5}
          readingSpeedWpm={200}
        />,
      );

      expect(
        screen.getByText(/10 \/ 20 nodes · 12 \/ 25 edges/),
      ).toBeInTheDocument();
      expect(screen.getByText("ELK Engine")).toBeInTheDocument();
      expect(screen.getByText(/Reading:/)).toBeInTheDocument();
    });
  });
});
