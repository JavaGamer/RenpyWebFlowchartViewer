// @vitest-environment jsdom
import React from "react";
import { render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useViewerStore } from "../../src/application/viewerStore.ts";
import {
  ChapterNodeComponent,
  DecisionNodeComponent,
  LabelNodeComponent,
  MenuNodeComponent,
} from "../../src/ui/viewerNodes.tsx";
import {
  useCanvasLodMode,
  useIsLodMode,
} from "../../src/ui/hooks/useLodMode.ts";
import { ViewerPresentationProvider } from "../../src/ui/viewerContext.tsx";

function setMockZoom(zoom: number) {
  (
    globalThis as unknown as {
      __mockReactFlowState?: { transform?: number[] };
    }
  ).__mockReactFlowState = {
    transform: [0, 0, zoom],
  };
}

function renderWithPresentation(
  ui: React.ReactElement,
  options: { isLod?: boolean; searchInput?: string } = {},
) {
  return render(
    <ViewerPresentationProvider
      isLod={options.isLod ?? false}
      searchInput={options.searchInput ?? ""}
      readingSpeedWpm={200}
      layoutDirection="TB"
      showAudioAssetCues={true}
      showPacingHeatmap={false}
    >
      {ui}
    </ViewerPresentationProvider>,
  );
}

const REQUIRED_HANDLE_IDS = [
  "target-top",
  "target-bottom",
  "target-left",
  "target-right",
  "source-top",
  "source-bottom",
  "source-left",
  "source-right",
];

describe("Level of Detail (LOD) Canvas Zooming", () => {
  beforeEach(() => {
    globalThis.localStorage.clear();
    useViewerStore.setState({
      theme: "violet",
      layoutDirection: "TB",
      enableLodZooming: true,
      searchInput: "",
      showAudioAssetCues: true,
      showPacingHeatmap: false,
    });
    setMockZoom(1.0);
  });

  afterEach(() => {
    delete (
      globalThis as unknown as {
        __mockReactFlowState?: { transform?: number[] };
      }
    ).__mockReactFlowState;
  });

  describe("useCanvasLodMode hook", () => {
    it("returns false when zoom is >= 0.40", () => {
      setMockZoom(1.0);
      const { result: r1 } = renderHook(() => useCanvasLodMode());
      expect(r1.current).toBe(false);

      setMockZoom(0.5);
      const { result: r2 } = renderHook(() => useCanvasLodMode());
      expect(r2.current).toBe(false);

      setMockZoom(0.40);
      const { result: r3 } = renderHook(() => useCanvasLodMode());
      expect(r3.current).toBe(false);
    });

    it("activates LOD mode when zoom drops below 0.40", () => {
      setMockZoom(0.39);
      const { result: r1 } = renderHook(() => useCanvasLodMode());
      expect(r1.current).toBe(true);

      setMockZoom(0.20);
      const { result: r2 } = renderHook(() => useCanvasLodMode());
      expect(r2.current).toBe(true);
    });

    it("returns false when enableLodZooming is disabled even at low zoom", () => {
      useViewerStore.getState().setEnableLodZooming(false);
      setMockZoom(0.1);

      const { result } = renderHook(() => useCanvasLodMode());
      expect(result.current).toBe(false);
    });
  });

  describe("useIsLodMode hook", () => {
    it("returns isLod from ViewerPresentationProvider", () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <ViewerPresentationProvider
          isLod={true}
          searchInput=""
          readingSpeedWpm={200}
          layoutDirection="TB"
          showAudioAssetCues={true}
          showPacingHeatmap={false}
        >
          {children}
        </ViewerPresentationProvider>
      );
      const { result } = renderHook(() => useIsLodMode(), { wrapper });
      expect(result.current).toBe(true);
    });
  });

  describe("LabelNodeComponent", () => {
    const nodeData = {
      label: "start_game",
      nodeType: "LABEL" as const,
      dialogueCount: 42,
      wordCount: 350,
      pauseDuration: 5,
      routeStepIndex: 3,
      audioAssetCues: [
        { type: "play" as const, channel: "music", raw: "play music track1" },
      ],
    };

    it("renders full card details and preserves all 8 handles at high zoom", () => {
      const { container } = renderWithPresentation(
        <LabelNodeComponent
          id="node-1"
          data={nodeData}
          selected={false}
          zIndex={0}
          isConnectable={true}
          positionAbsoluteX={0}
          positionAbsoluteY={0}
          dragging={false}
          type="labelNode"
        />,
        { isLod: false },
      );

      expect(screen.getByText("start_game")).toBeInTheDocument();
      expect(screen.getByText(/42 dialogue lines/i)).toBeInTheDocument();
      expect(screen.getByText("#3")).toBeInTheDocument();
      expect(container.querySelector(".rounded-xl")).toBeInTheDocument();

      for (const handleId of REQUIRED_HANDLE_IDS) {
        expect(
          container.querySelector(`[data-handleid="${handleId}"]`),
        ).toBeInTheDocument();
      }
    });

    it("renders compact pill, preserves bounds and all 8 handles in LOD mode", () => {
      const { container } = renderWithPresentation(
        <LabelNodeComponent
          id="node-1"
          data={nodeData}
          selected={false}
          zIndex={0}
          isConnectable={true}
          positionAbsoluteX={0}
          positionAbsoluteY={0}
          dragging={false}
          type="labelNode"
        />,
        { isLod: true },
      );

      expect(screen.getByText("start_game")).toBeInTheDocument();
      expect(screen.getByText("#3")).toBeInTheDocument();
      expect(screen.queryByText(/42 dialogue lines/i)).not.toBeInTheDocument();
      expect(container.querySelector(".rounded-full")).toBeInTheDocument();

      // Outer wrapper maintains layout bounding minHeight
      const outer = container.firstElementChild as HTMLElement;
      expect(outer.style.minHeight).toBeTruthy();

      for (const handleId of REQUIRED_HANDLE_IDS) {
        expect(
          container.querySelector(`[data-handleid="${handleId}"]`),
        ).toBeInTheDocument();
      }
    });

    it("applies search text highlighting inside LOD pill", () => {
      renderWithPresentation(
        <LabelNodeComponent
          id="node-1"
          data={nodeData}
          selected={false}
          zIndex={0}
          isConnectable={true}
          positionAbsoluteX={0}
          positionAbsoluteY={0}
          dragging={false}
          type="labelNode"
        />,
        { isLod: true, searchInput: "game" },
      );

      expect(screen.getByText("game")).toBeInTheDocument();
    });
  });

  describe("MenuNodeComponent", () => {
    const nodeData = {
      label: "choice_menu",
      nodeType: "MENU" as const,
      dialogueCount: 5,
      routeStepIndex: 1,
    };

    it("renders compact pill, maintains layout minHeight and all 8 handles in LOD mode", () => {
      const { container } = renderWithPresentation(
        <MenuNodeComponent
          id="node-2"
          data={nodeData}
          selected={false}
          zIndex={0}
          isConnectable={true}
          positionAbsoluteX={0}
          positionAbsoluteY={0}
          dragging={false}
          type="menuNode"
        />,
        { isLod: true },
      );

      expect(screen.getByText("choice_menu")).toBeInTheDocument();
      expect(screen.getByText("#1")).toBeInTheDocument();
      expect(screen.queryByText(/5 dialogue lines/i)).not.toBeInTheDocument();
      expect(container.querySelector(".rounded-full")).toBeInTheDocument();

      const outer = container.firstElementChild as HTMLElement;
      expect(outer.style.minHeight).toBe("80px");

      for (const handleId of REQUIRED_HANDLE_IDS) {
        expect(
          container.querySelector(`[data-handleid="${handleId}"]`),
        ).toBeInTheDocument();
      }
    });
  });

  describe("DecisionNodeComponent", () => {
    const nodeData = {
      label: "flag_check",
      conditionExpression: "has_key == True",
      nodeType: "DECISION" as const,
    };

    it("renders compact pill, preserves 176px layout height and all 8 handles in LOD mode", () => {
      const { container } = renderWithPresentation(
        <DecisionNodeComponent
          id="node-3"
          data={nodeData}
          selected={false}
          zIndex={0}
          isConnectable={true}
          positionAbsoluteX={0}
          positionAbsoluteY={0}
          dragging={false}
          type="decisionNode"
        />,
        { isLod: true },
      );

      expect(screen.getByText("has_key == True")).toBeInTheDocument();
      expect(container.querySelector(".rounded-full")).toBeInTheDocument();

      const outer = container.firstElementChild as HTMLElement;
      expect(outer.style.height).toBe("176px");

      for (const handleId of REQUIRED_HANDLE_IDS) {
        expect(
          container.querySelector(`[data-handleid="${handleId}"]`),
        ).toBeInTheDocument();
      }
    });
  });

  describe("ChapterNodeComponent", () => {
    const collapsedNodeData = {
      chapter: "Chapter 1",
      nodeType: "CHAPTER" as const,
      isCollapsed: true,
      chapterNodeCount: 15,
      chapterTotalDialogueCount: 120,
    };

    const expandedNodeData = {
      chapter: "Chapter 1",
      nodeType: "CHAPTER" as const,
      isCollapsed: false,
      chapterNodeCount: 15,
      chapterTotalDialogueCount: 120,
      totalWords: 1500,
    };

    it("renders compact pill when collapsed in LOD mode, preserving 110px minHeight and handles", () => {
      const { container } = renderWithPresentation(
        <ChapterNodeComponent
          id="node-4"
          data={collapsedNodeData}
          selected={false}
          zIndex={0}
          isConnectable={true}
          positionAbsoluteX={0}
          positionAbsoluteY={0}
          dragging={false}
          type="chapterNode"
        />,
        { isLod: true },
      );

      expect(screen.getByText("Chapter 1")).toBeInTheDocument();
      expect(screen.getByText("15")).toBeInTheDocument();
      expect(container.querySelector(".rounded-full")).toBeInTheDocument();

      const outer = container.firstElementChild as HTMLElement;
      expect(outer.style.minHeight).toBe("110px");

      for (const handleId of REQUIRED_HANDLE_IDS) {
        expect(
          container.querySelector(`[data-handleid="${handleId}"]`),
        ).toBeInTheDocument();
      }
    });

    it("renders detailed header when expanded at high zoom", () => {
      renderWithPresentation(
        <ChapterNodeComponent
          id="node-5"
          data={expandedNodeData}
          selected={false}
          zIndex={0}
          isConnectable={true}
          positionAbsoluteX={0}
          positionAbsoluteY={0}
          dragging={false}
          type="chapterNode"
        />,
        { isLod: false },
      );

      expect(screen.getByText("Chapter 1")).toBeInTheDocument();
      expect(screen.getByText(/15 nodes/i)).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /Collapse chapter container/i }),
      ).toBeInTheDocument();
    });

    it("renders streamlined header without detailed metrics when expanded in LOD mode", () => {
      renderWithPresentation(
        <ChapterNodeComponent
          id="node-5"
          data={expandedNodeData}
          selected={false}
          zIndex={0}
          isConnectable={true}
          positionAbsoluteX={0}
          positionAbsoluteY={0}
          dragging={false}
          type="chapterNode"
        />,
        { isLod: true },
      );

      expect(screen.getByText("Chapter 1")).toBeInTheDocument();
      expect(screen.queryByText(/15 nodes/i)).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /Collapse chapter container/i }),
      ).not.toBeInTheDocument();
    });
  });
});
