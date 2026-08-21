import type {
  CanvasEdge,
  CanvasNode,
  ConditionReachability,
  ConditionVisibilityMode,
  EdgeData,
  EdgeKindFilter,
  NodeData,
  ThemeName,
} from "../index.ts";
import {
  evaluateConditionExpression,
  type MockFlagValue,
} from "../conditionLogic.ts";
import { normalizeEdgeKind } from "./integrity.ts";

/**
 * Computes which nodes should be visible on the canvas based on the current
 * search query, dialogue filters, collapse state, and conditional simulation output.
 *
 * Uses a memo-optimization to short-circuit and return the previous node reference
 * unchanged when none of its observable properties have changed — preventing
 * unnecessary React re-renders in the canvas.
 *
 * @param params.nodes All canvas nodes in layout order.
 * @param params.search Current search query string.
 * @param params.searchMatchNodeIds Precomputed fuzzy-search match set (or null for linear scan).
 * @param params.includeDialogueLineSearch Whether to scan dialogue line arrays during text search.
 * @param params.dialogueMatchNodeIds Nodes that contain dialogue lines matching the query.
 * @param params.minDialogue Minimum dialogue count threshold for visibility.
 * @param params.collapsedChapters Chapter names that are currently collapsed.
 * @param params.collapsedLabelChildren Label node IDs whose sub-graph is collapsed.
 * @param params.conditionHiddenNodeIds Nodes determined unreachable by condition simulation.
 * @param params.theme Active color theme name.
 * @param params.previousById Previous render's node map for memo comparison.
 * @returns Updated node array with correct `hidden` flags and theme data.
 */

export function buildVisibleNodes(params: {
  nodes: CanvasNode[];
  search: string;
  searchMatchNodeIds?: Set<string> | null;
  includeDialogueLineSearch?: boolean;
  dialogueMatchNodeIds?: Set<string> | null;
  minDialogue: number;
  collapsedChapters: Record<string, boolean>;
  collapsedLabelChildren: Set<string>;
  conditionHiddenNodeIds?: Set<string>;
  theme: ThemeName;
  previousById?: Map<string, CanvasNode>;
  highlightedRouteNodeIds?: Set<string> | null;
  stepOrderMap?: Record<string, number> | null;
}): CanvasNode[] {
  const {
    nodes,
    search,
    searchMatchNodeIds = null,
    includeDialogueLineSearch = true,
    dialogueMatchNodeIds = null,
    minDialogue,
    collapsedChapters,
    collapsedLabelChildren,
    conditionHiddenNodeIds,
    theme,
    previousById,
    highlightedRouteNodeIds = null,
    stepOrderMap = null,
  } = params;
  const query = search.trim().toLowerCase();
  const hasRouteHighlight = Boolean(
    highlightedRouteNodeIds && highlightedRouteNodeIds.size > 0,
  );

  return nodes.map((n) => {
    const nodeData = n.data as NodeData;
    const dialogueCountMatch = String(nodeData.dialogueCount).includes(query);
    const chapterCollapsed = nodeData.chapter
      ? collapsedChapters[nodeData.chapter]
      : false;
    const labelCollapsed = collapsedLabelChildren.has(n.id);
    const matchesSearch = query.length === 0 ||
      (searchMatchNodeIds
        ? (searchMatchNodeIds.has(n.id) ||
          (dialogueMatchNodeIds ? dialogueMatchNodeIds.has(n.id) : false))
        : (nodeData.label.toLowerCase().includes(query) ||
          dialogueCountMatch ||
          (dialogueMatchNodeIds ? dialogueMatchNodeIds.has(n.id) : false) ||
          (includeDialogueLineSearch &&
            (nodeData.dialogueLines ?? []).some((line) =>
              line.toLowerCase().includes(query)
            ))));
    const matchesDialogue = nodeData.dialogueCount >= minDialogue;
    const hidden = Boolean(
      chapterCollapsed ||
        labelCollapsed ||
        (conditionHiddenNodeIds?.has(n.id) ?? false) ||
        !matchesSearch ||
        !matchesDialogue,
    );

    const isRouteHighlighted = hasRouteHighlight
      ? Boolean(highlightedRouteNodeIds?.has(n.id))
      : false;
    const isRouteDimmed = hasRouteHighlight && !isRouteHighlighted;
    const routeStepIndex = isRouteHighlighted && stepOrderMap
      ? stepOrderMap[n.id]
      : undefined;

    const previous = previousById?.get(n.id);
    if (previous) {
      const prevData = previous.data as NodeData;
      if (
        previous.hidden === hidden &&
        previous.position.x === n.position.x &&
        previous.position.y === n.position.y &&
        previous.selected === n.selected &&
        previous.dragging === n.dragging &&
        previous.draggable === n.draggable &&
        previous.selectable === n.selectable &&
        previous.width === n.width &&
        previous.height === n.height &&
        previous.measured?.width === n.measured?.width &&
        previous.measured?.height === n.measured?.height &&
        prevData.theme === theme &&
        prevData.label === nodeData.label &&
        prevData.dialogueCount === nodeData.dialogueCount &&
        prevData.wordCount === nodeData.wordCount &&
        prevData.pauseDuration === nodeData.pauseDuration &&
        prevData.collapsedLabels === nodeData.collapsedLabels &&
        prevData.dialogueLines === nodeData.dialogueLines &&
        prevData.audioAssetCues === nodeData.audioAssetCues &&
        prevData.nodeType === nodeData.nodeType &&
        prevData.chapter === nodeData.chapter &&
        prevData.parentLabelId === nodeData.parentLabelId &&
        prevData.role === nodeData.role &&
        prevData.isShadowed === nodeData.isShadowed &&
        prevData.shadowOfId === nodeData.shadowOfId &&
        prevData.isTerminalOutcome === nodeData.isTerminalOutcome &&
        prevData.isOrphan === nodeData.isOrphan &&
        prevData.isDetailsLoaded === nodeData.isDetailsLoaded &&
        prevData.parameters === nodeData.parameters &&
        prevData.characterDialogue === nodeData.characterDialogue &&
        prevData.isRouteHighlighted === isRouteHighlighted &&
        prevData.isRouteDimmed === isRouteDimmed &&
        prevData.routeStepIndex === routeStepIndex
      ) {
        return previous;
      }
    }
    return {
      ...n,
      data: {
        ...nodeData,
        theme,
        isRouteHighlighted,
        isRouteDimmed,
        routeStepIndex,
      },
      hidden,
    };
  });
}

/**
 * Computes which edges should be visible based on the current edge kind filters,
 * visible node set, and conditional branch reachability state.
 *
 * Applies fade or hide styling to unreachable condition branches based on the
 * active `conditionVisibilityMode`. Edges whose source or target are not in the
 * visible node set are always excluded.
 *
 * Uses a memo-optimization: edges whose properties match the previous render are
 * returned unchanged to avoid unnecessary React re-renders.
 *
 * @param params.edges All canvas edges.
 * @param params.showCallReturns Whether call-return edges should be shown.
 * @param params.visibleEdgeKinds Map of edge kind → visibility toggle booleans.
 * @param params.visibleNodeIds Set of currently visible node IDs.
 * @param params.edgeColor Active theme stroke color for edges.
 * @param params.largeGraphMode When true, suppresses sequence edge labels for performance.
 * @param params.conditionVisibilityMode Whether unreachable edges are 'fade' or 'hide'.
 * @param params.edgeConditionStateById Map from edge ID to reachability state.
 * @param params.previousById Previous render's edge map for memo comparison.
 * @returns Filtered and styled edge array.
 */
export function buildVisibleEdges(params: {
  edges: CanvasEdge[];
  showCallReturns: boolean;
  visibleEdgeKinds: Record<EdgeKindFilter, boolean>;
  visibleNodeIds: Set<string>;
  nonHiddenNodeIds?: Set<string>;
  edgeColor: string;
  decisionColor?: string;
  labelColor?: string;
  menuColor?: string;
  accentColor?: string;
  largeGraphMode: boolean;
  conditionVisibilityMode?: ConditionVisibilityMode;
  edgeConditionStateById?: Map<string, ConditionReachability>;
  previousById?: Map<string, CanvasEdge>;
  selectedCallContextId?: string | null;
  highlightedRouteEdgeIds?: Set<string> | null;
}): CanvasEdge[] {
  const {
    edges,
    showCallReturns,
    visibleEdgeKinds,
    visibleNodeIds,
    nonHiddenNodeIds,
    edgeColor,
    decisionColor,
    labelColor,
    menuColor,
    accentColor,
    largeGraphMode,
    conditionVisibilityMode = "fade",
    edgeConditionStateById,
    previousById,
    selectedCallContextId,
    highlightedRouteEdgeIds = null,
  } = params;
  const visible: CanvasEdge[] = [];
  const isCallContextActive = Boolean(selectedCallContextId);
  const hasRouteHighlight = Boolean(
    highlightedRouteEdgeIds && highlightedRouteEdgeIds.size > 0,
  );

  for (const edge of edges) {
    const edgeData = (edge.data as EdgeData | undefined) ?? { label: "" };
    const kind = normalizeEdgeKind(edgeData.kind);
    if (!visibleEdgeKinds[kind]) continue;
    if (!showCallReturns && kind === "call_return") continue;
    const conditionState = edgeConditionStateById?.get(edge.id);
    if (
      conditionVisibilityMode === "hide" && conditionState === "unreachable"
    ) continue;
    const sourceNonHidden = nonHiddenNodeIds
      ? nonHiddenNodeIds.has(edge.source)
      : visibleNodeIds.has(edge.source);
    const targetNonHidden = nonHiddenNodeIds
      ? nonHiddenNodeIds.has(edge.target)
      : visibleNodeIds.has(edge.target);
    if (!sourceNonHidden || !targetNonHidden) continue;
    const sourceSpatiallyVisible = visibleNodeIds.has(edge.source);
    const targetSpatiallyVisible = visibleNodeIds.has(edge.target);
    if (!sourceSpatiallyVisible && !targetSpatiallyVisible) {
      continue;
    }
    const edgeLabel = largeGraphMode && kind === "sequence"
      ? ""
      : (edgeData.label ?? "");

    // Route highlighting matching
    const isInHighlightedRoute = hasRouteHighlight
      ? Boolean(highlightedRouteEdgeIds?.has(edge.id))
      : false;

    // Call context matching
    const matchesCallContext = isCallContextActive &&
      (edgeData.callContext?.callContextId === selectedCallContextId ||
        edgeData.callContext?.callEdgeId === selectedCallContextId ||
        edge.id === selectedCallContextId);

    // Semantic edge colors and dash styles
    let stroke = edgeColor;
    let strokeWidth = 1.5;
    let baseDash: string | undefined = undefined;
    let callContextOpacity: number | undefined = undefined;

    if (isInHighlightedRoute) {
      stroke = accentColor ?? "#8b5cf6";
      strokeWidth = 3.5;
    } else if (matchesCallContext) {
      stroke = accentColor ?? "#3b82f6";
      strokeWidth = 3.5;
      baseDash = "6 3";
    } else if (isCallContextActive && kind === "call_return") {
      callContextOpacity = 0.2;
      baseDash = "2 4";
    } else if (edgeData.condition) {
      stroke = decisionColor ?? edgeColor;
      baseDash = "5 3";
    } else if (kind === "call" || kind === "call_return") {
      stroke = labelColor ?? edgeColor;
      baseDash = "3 3";
    } else if (kind === "jump") {
      stroke = menuColor ?? edgeColor;
      baseDash = "6 3";
    }

    const timeoutDash = edgeData.timeout?.isTimeout ? "8 4" : undefined;

    const unreachableStyle =
      conditionVisibilityMode === "fade" && conditionState === "unreachable"
        ? {
          opacity: 0.28,
          strokeDasharray: timeoutDash || baseDash ? undefined : "5 4",
        }
        : {};

    let finalOpacity = callContextOpacity ?? unreachableStyle.opacity;
    if (hasRouteHighlight && !isInHighlightedRoute) {
      finalOpacity = 0.15;
      strokeWidth = 1.0;
    }

    const finalStrokeDasharray = timeoutDash ||
      unreachableStyle.strokeDasharray || baseDash;

    const previous = previousById?.get(edge.id);
    const previousData = previous?.data as EdgeData | undefined;
    if (
      previous &&
      previous.selected === edge.selected &&
      previous.animated === edge.animated &&
      previous.hidden === edge.hidden &&
      previousData?.label === edgeLabel &&
      previousData?.kind === kind &&
      previousData?.callContext === edgeData.callContext &&
      previousData?.timeout?.isTimeout === edgeData.timeout?.isTimeout &&
      previousData?.timeout?.durationSeconds ===
        edgeData.timeout?.durationSeconds &&
      previousData?.conditionState === conditionState &&
      previous.source === edge.source &&
      previous.target === edge.target &&
      previous.style?.stroke === stroke &&
      previous.style?.strokeWidth === strokeWidth &&
      previous.style?.opacity === finalOpacity &&
      previous.style?.strokeDasharray === finalStrokeDasharray
    ) {
      visible.push(previous);
      continue;
    }

    visible.push({
      ...edge,
      data: { ...edgeData, label: edgeLabel, kind, conditionState },
      style: {
        ...(edge.style || {}),
        ...unreachableStyle,
        stroke,
        strokeWidth,
        opacity: finalOpacity,
        strokeDasharray: finalStrokeDasharray,
      },
    });
  }
  return visible;
}

/**
 * Simulates conditional branch reachability across the visible edge graph
 * using the provided mock flag state (true / false / unknown per flag name).
 *
 * Algorithm:
 * 1. For each edge with condition metadata, evaluate the condition expression
 *    against the mock flags to get 'reachable', 'unreachable', or 'unknown'.
 * 2. Collect all flag references discovered across conditional edges.
 * 3. Identify all root nodes (no incoming edges) as traversal starting points.
 * 4. BFS/DFS from roots, following only non-unreachable edges.
 * 5. Any node not reached is considered conditionally hidden.
 *
 * @param params.edges All canvas edges (including conditional ones).
 * @param params.mockFlags User-configured flag simulation state.
 * @returns edgeConditionStateById, set of hidden node IDs, and discovered flag names.
 */
export function buildConditionalVisibility(params: {
  edges: CanvasEdge[];
  mockFlags: Record<string, MockFlagValue>;
}): {
  edgeConditionStateById: Map<string, ConditionReachability>;
  hiddenNodeIds: Set<string>;
  discoveredFlags: string[];
} {
  const edgeConditionStateById = new Map<string, ConditionReachability>();
  const discoveredFlagSet = new Set<string>();
  const nodeIds = new Set<string>();
  const incomingCounts = new Map<string, number>();
  const outgoing = new Map<string, CanvasEdge[]>();

  for (const edge of params.edges) {
    nodeIds.add(edge.source);
    nodeIds.add(edge.target);
    incomingCounts.set(edge.target, (incomingCounts.get(edge.target) ?? 0) + 1);
    const sourceOutgoing = outgoing.get(edge.source) ?? [];
    sourceOutgoing.push(edge);
    outgoing.set(edge.source, sourceOutgoing);

    const edgeData = (edge.data as EdgeData | undefined) ?? { label: "" };
    const condition = edgeData.condition;
    if (!condition) continue;
    for (const ref of condition.references ?? []) {
      discoveredFlagSet.add(ref);
    }
    const evaluated = evaluateConditionExpression(
      condition.expression,
      params.mockFlags,
    );
    const conditionState: ConditionReachability = evaluated === "true"
      ? "reachable"
      : evaluated === "false"
      ? "unreachable"
      : "unknown";
    edgeConditionStateById.set(edge.id, conditionState);
  }

  const roots = Array.from(nodeIds).filter((nodeId) =>
    (incomingCounts.get(nodeId) ?? 0) === 0
  );

  // 1. Discover baseRoots: structural roots + 1 seed per isolated component/cycle
  const baseRoots: string[] = [];
  const structurallyVisited = new Set<string>();

  const candidateSeeds = roots.length > 0 ? roots : Array.from(nodeIds);
  for (const seed of candidateSeeds) {
    if (structurallyVisited.has(seed)) continue;
    baseRoots.push(seed);
    const structStack = [seed];
    while (structStack.length > 0) {
      const curr = structStack.pop()!;
      if (structurallyVisited.has(curr)) continue;
      structurallyVisited.add(curr);
      for (const edge of outgoing.get(curr) ?? []) {
        structStack.push(edge.target);
      }
    }
  }

  for (const id of nodeIds) {
    if (!structurallyVisited.has(id)) {
      baseRoots.push(id);
      const structStack = [id];
      while (structStack.length > 0) {
        const curr = structStack.pop()!;
        if (structurallyVisited.has(curr)) continue;
        structurallyVisited.add(curr);
        for (const edge of outgoing.get(curr) ?? []) {
          structStack.push(edge.target);
        }
      }
    }
  }

  // 2. Perform conditional reachability BFS starting strictly from baseRoots
  const reachableNodeIds = new Set<string>();
  const stack = [...baseRoots];
  while (stack.length > 0) {
    const nodeId = stack.pop();
    if (!nodeId) continue;
    if (reachableNodeIds.has(nodeId)) continue;
    reachableNodeIds.add(nodeId);

    for (const edge of outgoing.get(nodeId) ?? []) {
      const edgeState = edgeConditionStateById.get(edge.id);
      if (edgeState === "unreachable") continue;
      stack.push(edge.target);
    }
  }

  const hiddenNodeIds = new Set<string>();
  for (const nodeId of nodeIds) {
    if (!reachableNodeIds.has(nodeId)) {
      hiddenNodeIds.add(nodeId);
    }
  }

  return {
    edgeConditionStateById,
    hiddenNodeIds,
    discoveredFlags: Array.from(discoveredFlagSet).sort((
      a,
      b,
    ) => (a < b ? -1 : a > b ? 1 : 0)),
  };
}
