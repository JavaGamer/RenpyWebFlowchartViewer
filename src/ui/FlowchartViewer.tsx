import {
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { type ReactFlowInstance } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { ErrorBoundary } from "react-error-boundary";
import {
  exportToHtmlBundle,
  exportToMermaid,
  exportToStoryboardWithHydration,
} from "../application/index.ts";
import { useStore } from "zustand";
import { useShallow } from "zustand/react/shallow";
import type {
  CanvasEdge,
  CanvasNode,
  FlowEdge,
  FlowNode,
} from "../domain/index.ts";
import {
  type DebugBundlePrivacyOptions,
  type DialogueSearchMode,
  type ParseService,
  useAppStore,
  useDebugBundle,
  useViewerStore,
} from "../application/index.ts";

import {
  createPerfTracker,
  workerParseService,
} from "../infrastructure/index.ts";
import { THEMES } from "./viewerTheme.ts";
import { ViewerToolbar } from "./ViewerToolbar.tsx";
import { CanvasErrorFallback } from "./CanvasErrorFallback.tsx";
import { FlowchartCanvas } from "./FlowchartCanvas.tsx";
import { dataUrlToBlob } from "./canvasHelpers.ts";
import type { CanvasCallbacksRegistry, CanvasMetrics } from "./canvasTypes.ts";

export interface FlowchartViewerProps {
  flowNodes?: FlowNode[];
  flowEdges?: FlowEdge[];
  dialogueSearchMode?: DialogueSearchMode;
  onDialogueSearchModeChange?: (mode: DialogueSearchMode) => void;
  parseService?: ParseService;
  debugPrivacyOptions?: DebugBundlePrivacyOptions;
  onDebugPrivacyOptionsChange?: (options: DebugBundlePrivacyOptions) => void;
  onExportDebugBundle?: (options: DebugBundlePrivacyOptions) => void;
  onOpenIssue?: (options: DebugBundlePrivacyOptions) => void;
}

export default function FlowchartViewer({
  flowNodes: propFlowNodes,
  flowEdges: propFlowEdges,
  dialogueSearchMode: propDialogueSearchMode,
  onDialogueSearchModeChange: propOnDialogueSearchModeChange,
  parseService = workerParseService,
  debugPrivacyOptions: propDebugPrivacyOptions,
  onDebugPrivacyOptionsChange: propOnDebugPrivacyOptionsChange,
  onExportDebugBundle: propOnExportDebugBundle,
  onOpenIssue: propOnOpenIssue,
}: FlowchartViewerProps) {
  const storeNodes = useAppStore((s) => s.flowNodes);
  const storeEdges = useAppStore((s) => s.flowEdges);
  const flowNodes = propFlowNodes ?? storeNodes;
  const flowEdges = propFlowEdges ?? storeEdges;

  const storeDialogueSearchMode = useAppStore((s) => s.dialogueSearchMode);
  const storeSetDialogueSearchMode = useAppStore((s) =>
    s.setDialogueSearchMode
  );
  const dialogueSearchMode = propDialogueSearchMode ?? storeDialogueSearchMode;
  const onDialogueSearchModeChange = propOnDialogueSearchModeChange ??
    storeSetDialogueSearchMode;

  const debug = useDebugBundle();
  const debugPrivacyOptions = propDebugPrivacyOptions ??
    debug.debugPrivacyOptions;
  const onDebugPrivacyOptionsChange = propOnDebugPrivacyOptionsChange ??
    debug.setDebugPrivacyOptions;
  const onExportDebugBundle = propOnExportDebugBundle ??
    debug.exportDebugBundle;
  const onOpenIssue = propOnOpenIssue ?? debug.openNewIssue;

  const perf = useMemo(() => createPerfTracker("viewer"), []);
  const flowRef = useRef<HTMLDivElement>(null);
  const flowInstanceRef = useRef<
    ReactFlowInstance<CanvasNode, CanvasEdge> | null
  >(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const resetSession = useViewerStore((s) => s.resetSession);
  const prevFlowNodesRef = useRef(flowNodes);
  useEffect(() => {
    if (prevFlowNodesRef.current !== flowNodes) {
      prevFlowNodesRef.current = flowNodes;
      resetSession();
    }
  }, [flowNodes, resetSession]);

  // Registry ref: inner component writes current onSearchInputKeyDown here;
  // outer provides a stable wrapper that calls it.
  const canvasCallbacksRef = useRef<CanvasCallbacksRegistry>({
    onSearchInputKeyDown: () => {},
  });
  const onSearchInputKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLInputElement>) =>
      canvasCallbacksRef.current.onSearchInputKeyDown(e),
    [],
  );

  // -- Minimal store reads for toolbar ----------------------------------------
  const {
    searchInput,
    minDialogue,
    theme,
    showAdvancedControls,
    standaloneDialogueSearchMode,
    selectedSearchChapter,
    selectedSearchNodeKinds,
    readingSpeedWpm,
  } = useViewerStore(useShallow((s) => ({
    searchInput: s.searchInput,
    minDialogue: s.minDialogue,
    theme: s.theme,
    showAdvancedControls: s.showAdvancedControls,
    standaloneDialogueSearchMode: s.standaloneDialogueSearchMode,
    selectedSearchChapter: s.selectedSearchChapter,
    selectedSearchNodeKinds: s.selectedSearchNodeKinds,
    readingSpeedWpm: s.readingSpeedWpm,
  })));
  const {
    setSearchInput,
    setMinDialogue,
    toggleShowAdvancedControls,
    setShowAdvancedControls,
    setStandaloneDialogueSearchMode,
    setSelectedSearchChapter,
    setSelectedSearchNodeKinds,
  } = useViewerStore(useShallow((s) => ({
    setSearchInput: s.setSearchInput,
    setMinDialogue: s.setMinDialogue,
    toggleShowAdvancedControls: s.toggleShowAdvancedControls,
    setShowAdvancedControls: s.setShowAdvancedControls,
    setStandaloneDialogueSearchMode: s.setStandaloneDialogueSearchMode,
    setSelectedSearchChapter: s.setSelectedSearchChapter,
    setSelectedSearchNodeKinds: s.setSelectedSearchNodeKinds,
  })));

  const uniqueChapters = useMemo(() => {
    const chapters = new Set<string>();
    for (const node of flowNodes) {
      if (node.chapter) {
        chapters.add(node.chapter);
      }
    }
    return Array.from(chapters).sort();
  }, [flowNodes]);

  const { undo, redo, pastStates, futureStates } = useStore(
    useViewerStore.temporal,
    useShallow((s) => ({
      undo: s.undo,
      redo: s.redo,
      pastStates: s.pastStates,
      futureStates: s.futureStates,
    })),
  );
  const canUndo = pastStates.length > 0;
  const canRedo = futureStates.length > 0;

  // -- Canvas metrics ---------------------------------------------------------
  // Seeded with totals; refined once FlowchartCanvas reports its first render.
  const [canvasMetrics, setCanvasMetrics] = useState<CanvasMetrics>({
    visibleNodeCount: flowNodes.length,
    visibleEdgeCount: flowEdges.length,
    dialogueLineSearchEnabled: false,
    isLargeExportTarget: false,
    totalWordCount: 0,
    totalPauseDuration: 0,
    visibleWordCount: 0,
    visiblePauseDuration: 0,
  });

  // -- Dialogue mode ----------------------------------------------------------
  const useAppStoreDialogueMode = !!propOnDialogueSearchModeChange ||
    !propFlowNodes;

  const selectedDialogueSearchMode = useAppStoreDialogueMode
    ? dialogueSearchMode
    : standaloneDialogueSearchMode;

  const handleDialogueModeChange = useCallback(
    (mode: DialogueSearchMode) => {
      if (propOnDialogueSearchModeChange) {
        propOnDialogueSearchModeChange(mode);
      } else if (!propFlowNodes) {
        storeSetDialogueSearchMode(mode);
      } else {
        setStandaloneDialogueSearchMode(mode);
      }
    },
    [
      propOnDialogueSearchModeChange,
      propFlowNodes,
      storeSetDialogueSearchMode,
      setStandaloneDialogueSearchMode,
    ],
  );

  // -- Toolbar callbacks ------------------------------------------------------
  const onExportMermaid = useCallback(async () => {
    const mermaidStr = exportToMermaid(flowNodes, flowEdges);
    const blob = new Blob([mermaidStr], { type: "text/plain" });
    const { saveAs } = await import("file-saver");
    saveAs(blob, "renpy-flowchart.mmd");
  }, [flowNodes, flowEdges]);

  const onExportStoryboard = useCallback(async () => {
    const mdStr = await exportToStoryboardWithHydration(flowNodes);
    const blob = new Blob([mdStr], { type: "text/plain" });
    const { saveAs } = await import("file-saver");
    saveAs(blob, "renpy-storyboard.md");
  }, [flowNodes]);

  const onExportHtmlBundle = useCallback(async () => {
    if (!flowRef.current) return;
    const { toSvg } = await import("html-to-image");
    const { saveAs } = await import("file-saver");
    toSvg(flowRef.current, {
      backgroundColor: THEMES[theme].pageBg,
      width: flowRef.current.offsetWidth,
      height: flowRef.current.offsetHeight,
    })
      .then((svgDataUrl) => {
        const htmlStr = exportToHtmlBundle(svgDataUrl);
        const blob = new Blob([htmlStr], { type: "text/html" });
        saveAs(blob, "renpy-flowchart-interactive.html");
      })
      .catch((err) => {
        console.error("HTML Bundle export failed:", err);
      });
  }, [theme]);

  const onExportJson = useCallback(async () => {
    const graphJson = JSON.stringify(
      { nodes: flowNodes, edges: flowEdges },
      null,
      2,
    );
    const blob = new Blob([graphJson], { type: "application/json" });
    const { saveAs } = await import("file-saver");
    saveAs(blob, "renpy-flowchart.json");
  }, [flowEdges, flowNodes]);

  const onExport = useCallback(async () => {
    if (!flowRef.current) return;
    const startedAt = performance.now();
    const { isLargeExportTarget, visibleNodeCount, visibleEdgeCount } =
      canvasMetrics;
    const pixelRatio = isLargeExportTarget ? 1 : 2;
    const { toBlob } = await import("html-to-image");
    const { saveAs } = await import("file-saver");
    toBlob(flowRef.current, {
      backgroundColor: THEMES[theme].pageBg,
      pixelRatio,
      width: flowRef.current.offsetWidth,
      height: flowRef.current.offsetHeight,
    })
      .then((blob) => {
        if (!blob) return;
        saveAs(blob, "renpy-flowchart.png");
        perf.log("export_png_ms", performance.now() - startedAt, {
          nodeCount: visibleNodeCount,
          edgeCount: visibleEdgeCount,
        });
      })
      .catch((err: unknown) => {
        console.error("Export failed:", err);
      });
  }, [canvasMetrics, perf, theme]);

  const onExportSvg = useCallback(async () => {
    if (!flowRef.current) return;
    const startedAt = performance.now();
    const { visibleNodeCount, visibleEdgeCount } = canvasMetrics;
    const { toSvg } = await import("html-to-image");
    const { saveAs } = await import("file-saver");
    toSvg(flowRef.current, {
      backgroundColor: THEMES[theme].pageBg,
      width: flowRef.current.offsetWidth,
      height: flowRef.current.offsetHeight,
    })
      .then((svgDataUrl) => {
        const svgBlob = dataUrlToBlob(svgDataUrl);
        saveAs(svgBlob, "renpy-flowchart.svg");
        perf.log("export_svg_ms", performance.now() - startedAt, {
          nodeCount: visibleNodeCount,
          edgeCount: visibleEdgeCount,
        });
      })
      .catch((err: unknown) => {
        console.error("SVG export failed:", err);
      });
  }, [canvasMetrics, perf, theme]);

  const onFitView = useCallback(() => {
    flowInstanceRef.current?.fitView({ padding: 0.2 });
  }, []);

  const onDebugOptionChange = useCallback(
    (patch: Partial<DebugBundlePrivacyOptions>) => {
      if (!onDebugPrivacyOptionsChange) return;
      onDebugPrivacyOptionsChange({ ...debugPrivacyOptions, ...patch });
    },
    [debugPrivacyOptions, onDebugPrivacyOptionsChange],
  );

  // -- Global keyboard shortcuts ----------------------------------------------
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isInput = target && (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        target.isContentEditable
      );

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        setShowAdvancedControls(false);
        setTimeout(() => {
          searchInputRef.current?.focus();
          searchInputRef.current?.select();
        }, 0);
        return;
      }
      if (isInput) return;

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "e") {
        event.preventDefault();
        onExport();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "l") {
        event.preventDefault();
        flowInstanceRef.current?.fitView({ padding: 0.2 });
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (canUndo) undo();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
        event.preventDefault();
        if (canRedo) redo();
      }
    };
    globalThis.addEventListener("keydown", onKeyDown);
    return () => globalThis.removeEventListener("keydown", onKeyDown);
  }, [onExport, canUndo, canRedo, undo, redo, setShowAdvancedControls]);

  // -- Render -----------------------------------------------------------------
  return (
    <div
      className="flex flex-col h-full min-h-0"
      style={{
        backgroundColor: THEMES[theme].pageBg,
        color: THEMES[theme].text,
      }}
      data-theme={theme}
    >
      {/* Toolbar - always rendered, even when the canvas has errored */}
      <ViewerToolbar
        theme={theme}
        visibleNodeCount={canvasMetrics.visibleNodeCount}
        totalNodeCount={flowNodes.length}
        visibleEdgeCount={canvasMetrics.visibleEdgeCount}
        totalEdgeCount={flowEdges.length}
        totalWordCount={canvasMetrics.totalWordCount}
        totalPauseDuration={canvasMetrics.totalPauseDuration}
        visibleWordCount={canvasMetrics.visibleWordCount}
        visiblePauseDuration={canvasMetrics.visiblePauseDuration}
        readingSpeedWpm={readingSpeedWpm}
        searchInput={searchInput}
        setSearchInput={setSearchInput}
        searchInputRef={searchInputRef}
        onSearchInputKeyDown={onSearchInputKeyDown}
        dialogueLineSearchEnabled={canvasMetrics.dialogueLineSearchEnabled}
        minDialogue={minDialogue}
        setMinDialogue={setMinDialogue}
        selectedDialogueSearchMode={selectedDialogueSearchMode}
        onDialogueSearchModeChange={handleDialogueModeChange}
        isLargeExportTarget={canvasMetrics.isLargeExportTarget}
        onExport={onExport}
        onExportSvg={onExportSvg}
        onExportJson={onExportJson}
        onExportMermaid={onExportMermaid}
        onExportStoryboard={onExportStoryboard}
        onExportHtmlBundle={onExportHtmlBundle}
        onExportDebugBundle={onExportDebugBundle}
        onOpenIssue={onOpenIssue}
        debugPrivacyOptions={debugPrivacyOptions}
        onDebugOptionChange={onDebugOptionChange}
        onFitView={onFitView}
        onZoomTo={(preset) =>
          flowInstanceRef.current?.zoomTo(preset, { duration: 250 })}
        showAdvancedControls={showAdvancedControls}
        toggleShowAdvancedControls={toggleShowAdvancedControls}
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={undo}
        onRedo={redo}
        selectedSearchChapter={selectedSearchChapter}
        setSelectedSearchChapter={setSelectedSearchChapter}
        selectedSearchNodeKinds={selectedSearchNodeKinds}
        setSelectedSearchNodeKinds={setSelectedSearchNodeKinds}
        uniqueChapters={uniqueChapters}
      />

      {
        /* ErrorBoundary wraps FlowchartCanvas so errors from layout hooks,
          graph-derivation, or ReactFlow rendering are all contained here.
          The toolbar above continues to function after any such error. */
      }
      <ErrorBoundary FallbackComponent={CanvasErrorFallback}>
        <FlowchartCanvas
          flowNodes={flowNodes}
          flowEdges={flowEdges}
          flowRef={flowRef}
          flowInstanceRef={flowInstanceRef}
          searchInputRef={searchInputRef}
          canvasCallbacksRef={canvasCallbacksRef}
          parseService={parseService}
          dialogueSearchMode={dialogueSearchMode}
          onDialogueSearchModeChange={onDialogueSearchModeChange}
          perf={perf}
          onMetrics={setCanvasMetrics}
        />
      </ErrorBoundary>
    </div>
  );
}
