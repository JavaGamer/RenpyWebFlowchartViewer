import { useCallback, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { useViewerStore } from "../../application/index.ts";
import type {
  CanvasEdge,
  CanvasNode,
  FlowEdge,
  FlowNode,
} from "../../domain/index.ts";
import {
  buildConditionalVisibility,
  buildVisibleEdges,
  buildVisibleNodes,
} from "../../domain/index.ts";
import { THEMES } from "../viewerTheme.ts";
import type {
  DialogueSearchMode,
  ParseService,
} from "../../application/index.ts";
import { useViewerSearch } from "./useViewerSearch.ts";
import { deriveCollapsedLabelChildren } from "../canvasHelpers.ts";
import type { ChapterStats } from "../components/ChapterFiltersSettings.tsx";
import {
  LARGE_EXPORT_GRAPH_ELEMENTS_THRESHOLD,
  LARGE_GRAPH_EDGE_THRESHOLD,
  LARGE_GRAPH_NODE_THRESHOLD,
} from "../../config/viewerConfig.ts";
import { MAX_VISIBLE_LABEL_SUBGRAPH_TOGGLES } from "../viewerConstants.ts";

import { type AABB, createSpatialIndex } from "../../infrastructure/index.ts";

export interface UseGraphVisibilityProps {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  flowNodes: FlowNode[];
  flowEdges: FlowEdge[];
  dialogueSearchMode: DialogueSearchMode;
  parseService: ParseService;
  previousVisibleNodesByIdRef: React.MutableRefObject<Map<string, CanvasNode>>;
  previousVisibleEdgesByIdRef: React.MutableRefObject<Map<string, CanvasEdge>>;
  viewportBounds?: AABB | null;
}

export function useGraphVisibility({
  nodes,
  edges,
  flowNodes,
  flowEdges,
  dialogueSearchMode,
  parseService,
  previousVisibleNodesByIdRef,
  previousVisibleEdgesByIdRef,
  viewportBounds,
}: UseGraphVisibilityProps) {
  const {
    searchInput,
    labelSubgraphSearchInput,
    minDialogue,
    theme,
    collapsedChapters,
    collapsedParentLabels,
    showCallReturns,
    visibleEdgeKinds,
    focusNodeId,
    largeGraphModeOverride,
    selectedNodeId,
    activeDialogueResultIndex,
    dialogueSearchResults,
    showAllLabelSubgraphToggles,
    standaloneDialogueSearchMode,
    mockFlags,
    conditionVisibilityMode,
    selectedSearchChapter,
    selectedSearchNodeKinds,
  } = useViewerStore(
    useShallow((s) => ({
      searchInput: s.searchInput,
      labelSubgraphSearchInput: s.labelSubgraphSearchInput,
      minDialogue: s.minDialogue,
      theme: s.theme,
      collapsedChapters: s.collapsedChapters,
      collapsedParentLabels: s.collapsedParentLabels,
      showCallReturns: s.showCallReturns,
      visibleEdgeKinds: s.visibleEdgeKinds,
      focusNodeId: s.focusNodeId,
      largeGraphModeOverride: s.largeGraphModeOverride,
      selectedNodeId: s.selectedNodeId,
      activeDialogueResultIndex: s.activeDialogueResultIndex,
      dialogueSearchResults: s.dialogueSearchResults,
      showAllLabelSubgraphToggles: s.showAllLabelSubgraphToggles,
      standaloneDialogueSearchMode: s.standaloneDialogueSearchMode,
      mockFlags: s.mockFlags,
      conditionVisibilityMode: s.conditionVisibilityMode,
      selectedSearchChapter: s.selectedSearchChapter,
      selectedSearchNodeKinds: s.selectedSearchNodeKinds,
    })),
  );

  const { setAllParentLabelsCollapsed, setDialogueSearchResults } =
    useViewerStore(
      useShallow((s) => ({
        setAllParentLabelsCollapsed: s.setAllParentLabelsCollapsed,
        setDialogueSearchResults: s.setDialogueSearchResults,
      })),
    );

  const selectedDialogueSearchMode = dialogueSearchMode !== "auto"
    ? dialogueSearchMode
    : standaloneDialogueSearchMode;

  const autoLargeGraphMode = useMemo(
    () =>
      flowNodes.length > LARGE_GRAPH_NODE_THRESHOLD ||
      flowEdges.length > LARGE_GRAPH_EDGE_THRESHOLD,
    [flowEdges.length, flowNodes.length],
  );
  const largeGraphMode = largeGraphModeOverride ?? autoLargeGraphMode;

  const effectiveDialogueSearchMode = useMemo<DialogueSearchMode>(
    () =>
      selectedDialogueSearchMode === "auto"
        ? (autoLargeGraphMode ? "countOnly" : "full")
        : selectedDialogueSearchMode,
    [autoLargeGraphMode, selectedDialogueSearchMode],
  );
  const dialogueLineSearchEnabled = effectiveDialogueSearchMode === "full";

  const chapters = useMemo(
    () =>
      Array.from(
        new Set(
          flowNodes
            .map((n) => n.chapter)
            .filter((chapter): chapter is string => Boolean(chapter)),
        ),
      ).sort(),
    [flowNodes],
  );

  const labels = useMemo(
    () =>
      nodes.filter((n) => n.data.nodeType === "LABEL").map((n) => n.id).sort(),
    [nodes],
  );

  const labelSubgraphSearch = labelSubgraphSearchInput.trim().toLowerCase();
  const visibleSubgraphLabels = useMemo(
    () =>
      labels.filter((label) =>
        labelSubgraphSearch.length === 0
          ? true
          : label.toLowerCase().includes(labelSubgraphSearch)
      ),
    [labelSubgraphSearch, labels],
  );

  const collapsedLabelCount = useMemo(
    () => labels.filter((label) => collapsedParentLabels[label]).length,
    [collapsedParentLabels, labels],
  );

  const shouldShowAllLabelSubgraphToggles = showAllLabelSubgraphToggles &&
    visibleSubgraphLabels.length > MAX_VISIBLE_LABEL_SUBGRAPH_TOGGLES;

  const visibleLabelSubgraphToggles = useMemo(
    () =>
      shouldShowAllLabelSubgraphToggles
        ? visibleSubgraphLabels
        : visibleSubgraphLabels.slice(0, MAX_VISIBLE_LABEL_SUBGRAPH_TOGGLES),
    [shouldShowAllLabelSubgraphToggles, visibleSubgraphLabels],
  );

  const largeGraphModeStatusText = useMemo(() => {
    if (autoLargeGraphMode && largeGraphModeOverride === null) {
      return "Auto-enabled from graph size.";
    }
    if (autoLargeGraphMode && largeGraphModeOverride !== null) {
      return "Auto-detected large graph; manual override active.";
    }
    if (!autoLargeGraphMode && largeGraphModeOverride === true) {
      return "Manually enabled.";
    }
    return "Off.";
  }, [autoLargeGraphMode, largeGraphModeOverride]);

  const collapsedLabelChildren = useMemo(
    () => deriveCollapsedLabelChildren(nodes, collapsedParentLabels),
    [collapsedParentLabels, nodes],
  );

  const setAllVisibleSubgraphLabelsCollapsed = useCallback(
    (collapsed: boolean) => {
      setAllParentLabelsCollapsed(visibleSubgraphLabels, collapsed);
    },
    [setAllParentLabelsCollapsed, visibleSubgraphLabels],
  );

  const conditionalVisibility = useMemo(
    () => buildConditionalVisibility({ edges, mockFlags }),
    [edges, mockFlags],
  );

  // -- Search hook ------------------------------------------------------------
  const {
    effectiveSearch,
    searchMatchNodeIds,
    dialogueMatchNodeIds,
    activeDialogueSearchResults,
    nodeSearchMatchIds,
  } = useViewerSearch({
    nodes,
    searchInput,
    largeGraphMode,
    dialogueLineSearchEnabled,
    collapsedChapters,
    collapsedLabelChildren,
    minDialogue,
    parseService,
    dialogueSearchResults,
    setDialogueSearchResults,
    selectedSearchChapter,
    selectedSearchNodeKinds,
  });

  // -- Visible nodes/edges ----------------------------------------------------
  const visibleNodes = useMemo(
    () =>
      buildVisibleNodes({
        nodes,
        search: effectiveSearch,
        searchMatchNodeIds,
        includeDialogueLineSearch: false,
        dialogueMatchNodeIds: dialogueLineSearchEnabled
          ? dialogueMatchNodeIds
          : null,
        minDialogue,
        collapsedChapters,
        collapsedLabelChildren,
        conditionHiddenNodeIds: conditionVisibilityMode === "hide"
          ? conditionalVisibility.hiddenNodeIds
          : undefined,
        theme,
        // eslint-disable-next-line react-hooks/refs
        previousById: previousVisibleNodesByIdRef.current,
      }),
    [
      collapsedChapters,
      collapsedLabelChildren,
      conditionVisibilityMode,
      conditionalVisibility.hiddenNodeIds,
      dialogueLineSearchEnabled,
      dialogueMatchNodeIds,
      effectiveSearch,
      minDialogue,
      nodes,
      previousVisibleNodesByIdRef,
      searchMatchNodeIds,
      theme,
    ],
  );

  const logicalVisibleNodes = visibleNodes;

  const spatialIndex = useMemo(() => {
    if (!viewportBounds || nodes.length < 150) return null;
    return createSpatialIndex(nodes);
  }, [nodes, viewportBounds]);

  const spatiallyFilteredNodes = useMemo(() => {
    if (!spatialIndex || !viewportBounds) return visibleNodes;
    const visibleIds = spatialIndex.queryRange(viewportBounds);
    return visibleNodes.filter(
      (n) =>
        !n.hidden &&
        (n.id === selectedNodeId ||
          n.id === focusNodeId ||
          visibleIds.has(n.id)),
    );
  }, [focusNodeId, selectedNodeId, spatialIndex, viewportBounds, visibleNodes]);

  const visibleNodeIds = useMemo(
    () => new Set(spatiallyFilteredNodes.map((n) => n.id)),
    [spatiallyFilteredNodes],
  );

  const visibleEdges = useMemo(
    () =>
      buildVisibleEdges({
        edges,
        showCallReturns,
        visibleEdgeKinds,
        visibleNodeIds,
        edgeColor: THEMES[theme].edge,
        decisionColor: THEMES[theme].decisionBorder,
        labelColor: THEMES[theme].labelBorder,
        menuColor: THEMES[theme].menuBorder,
        largeGraphMode,
        conditionVisibilityMode,
        edgeConditionStateById: conditionalVisibility.edgeConditionStateById,
        // eslint-disable-next-line react-hooks/refs
        previousById: previousVisibleEdgesByIdRef.current,
      }),
    [
      conditionalVisibility.edgeConditionStateById,
      conditionVisibilityMode,
      edges,
      largeGraphMode,
      previousVisibleEdgesByIdRef,
      showCallReturns,
      theme,
      visibleEdgeKinds,
      visibleNodeIds,
    ],
  );

  const selectedNode = useMemo(
    () =>
      visibleNodes.find((n) => n.id === selectedNodeId && !n.hidden) ?? null,
    [selectedNodeId, visibleNodes],
  );

  const nodeSearchMatchCount = useMemo(() => {
    if (!nodeSearchMatchIds) return 0;
    let matches = 0;
    for (const node of visibleNodes) {
      if (node.hidden) continue;
      if (nodeSearchMatchIds.has(node.id)) {
        matches += 1;
      }
    }
    return matches;
  }, [nodeSearchMatchIds, visibleNodes]);

  const resolvedActiveDialogueResultIndex = useMemo(() => {
    if (activeDialogueSearchResults.length === 0) return -1;
    if (activeDialogueResultIndex < 0) return 0;
    if (activeDialogueResultIndex >= activeDialogueSearchResults.length) {
      return activeDialogueSearchResults.length - 1;
    }
    return activeDialogueResultIndex;
  }, [activeDialogueResultIndex, activeDialogueSearchResults.length]);

  const isLargeExportTarget = useMemo(
    () =>
      visibleNodeIds.size + visibleEdges.length >=
        LARGE_EXPORT_GRAPH_ELEMENTS_THRESHOLD,
    [visibleEdges.length, visibleNodeIds.size],
  );

  const focusTargetNode = useMemo(
    () => visibleNodes.find((n) => n.id === focusNodeId && !n.hidden),
    [focusNodeId, visibleNodes],
  );

  const chapterStats = useMemo<ChapterStats>(() => {
    const map: ChapterStats = new Map();
    for (const node of flowNodes) {
      if (!node.chapter) continue;
      const existing = map.get(node.chapter);
      if (existing) {
        existing.wordCount += node.wordCount ?? 0;
        existing.pauseDuration += node.pauseDuration ?? 0;
      } else {
        map.set(node.chapter, {
          wordCount: node.wordCount ?? 0,
          pauseDuration: node.pauseDuration ?? 0,
        });
      }
    }
    return map;
  }, [flowNodes]);

  return {
    chapters,
    labels,
    visibleSubgraphLabels,
    collapsedLabelCount,
    shouldShowAllLabelSubgraphToggles,
    visibleLabelSubgraphToggles,
    largeGraphModeStatusText,
    collapsedLabelChildren,
    setAllVisibleSubgraphLabelsCollapsed,
    conditionalVisibility,
    effectiveSearch,
    searchMatchNodeIds,
    dialogueMatchNodeIds,
    activeDialogueSearchResults,
    nodeSearchMatchIds,
    logicalVisibleNodes,
    visibleNodes: spatiallyFilteredNodes,
    visibleNodeIds,
    visibleEdges,
    selectedNode,
    nodeSearchMatchCount,
    resolvedActiveDialogueResultIndex,
    isLargeExportTarget,
    focusTargetNode,
    chapterStats,
    dialogueLineSearchEnabled,
    largeGraphMode,
  };
}
