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
  activePathNodes?: Set<string> | null;
  theme: ThemeName;
  previousById?: Map<string, CanvasNode>;
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
    activePathNodes,
    theme,
    previousById,
  } = params;
  const query = search.trim().toLowerCase();
  return nodes.map((n) => {
    const nodeData = n.data as NodeData;
    const chapterCollapsed = nodeData?.chapter
      ? collapsedChapters[nodeData.chapter]
      : false;
    const labelCollapsed = collapsedLabelChildren.has(n.id);
    const matchesSearch = query.length === 0 ||
      (searchMatchNodeIds
        ? searchMatchNodeIds.has(n.id)
        : (nodeData?.label ?? "").toLowerCase().includes(query)) ||
      (dialogueMatchNodeIds ? dialogueMatchNodeIds.has(n.id) : false) ||
      (includeDialogueLineSearch &&
        (nodeData?.dialogueLines ?? []).some((line) =>
          line.toLowerCase().includes(query)
        ));
    const matchesDialogue = (nodeData?.dialogueCount ?? 0) >= minDialogue;
    const hidden = Boolean(
      chapterCollapsed ||
        labelCollapsed ||
        (conditionHiddenNodeIds?.has(n.id) ?? false) ||
        !matchesSearch ||
        !matchesDialogue,
    );

    const dimmed = activePathNodes ? !activePathNodes.has(n.id) : false;

    const previous = previousById?.get(n.id);
    if (previous) {
      const prevData = previous.data as NodeData;
      if (
        previous.hidden === hidden &&
        previous.position.x === n.position.x &&
        previous.position.y === n.position.y &&
        prevData.theme === theme &&
        prevData.label === nodeData.label &&
        prevData.dialogueCount === nodeData.dialogueCount &&
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
        prevData.characterDialogue === nodeData.characterDialogue &&
        previous.style?.opacity === (dimmed ? 0.28 : undefined)
      ) {
        return previous;
      }
    }
    return {
      ...n,
      data: { ...nodeData, theme },
      hidden,
      style: {
        ...(n.style || {}),
        opacity: dimmed ? 0.28 : undefined,
      },
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
  edgeColor: string;
  decisionColor?: string;
  labelColor?: string;
  menuColor?: string;
  largeGraphMode: boolean;
  conditionVisibilityMode?: ConditionVisibilityMode;
  edgeConditionStateById?: Map<string, ConditionReachability>;
  activePathEdges?: Set<string> | null;
  previousById?: Map<string, CanvasEdge>;
}): CanvasEdge[] {
  const {
    edges,
    showCallReturns,
    visibleEdgeKinds,
    visibleNodeIds,
    edgeColor,
    decisionColor,
    labelColor,
    menuColor,
    largeGraphMode,
    conditionVisibilityMode = "fade",
    edgeConditionStateById,
    activePathEdges,
    previousById,
  } = params;
  const visible: CanvasEdge[] = [];
  for (const edge of edges) {
    const edgeData = (edge.data as EdgeData | undefined) ?? { label: "" };
    const kind = normalizeEdgeKind(edgeData.kind);
    if (!visibleEdgeKinds[kind]) continue;
    if (!showCallReturns && kind === "call_return") continue;
    const conditionState = edgeConditionStateById?.get(edge.id);
    if (
      conditionVisibilityMode === "hide" && conditionState === "unreachable"
    ) continue;
    if (!visibleNodeIds.has(edge.source) || !visibleNodeIds.has(edge.target)) {
      continue;
    }
    const edgeLabel = largeGraphMode && kind === "sequence"
      ? ""
      : (edgeData.label ?? "");

    // Semantic edge colors and dash styles
    let stroke = edgeColor;
    let baseDash: string | undefined = undefined;

    if (edgeData.condition) {
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
    const isPathEdge = activePathEdges?.has(edge.id) ?? false;
    const isDimmed = activePathEdges ? !isPathEdge : false;

    const unreachableStyle =
      conditionVisibilityMode === "fade" && conditionState === "unreachable"
        ? {
          opacity: 0.28,
          strokeDasharray: timeoutDash || baseDash ? undefined : "5 4",
        }
        : {};

    const finalStrokeDasharray = timeoutDash ||
      unreachableStyle.strokeDasharray || baseDash;

    const finalOpacity = isDimmed ? 0.15 : (unreachableStyle.opacity ?? 1);

    const previous = previousById?.get(edge.id);
    const previousData = previous?.data as EdgeData | undefined;
    if (
      previous &&
      previousData?.label === edgeLabel &&
      previousData?.kind === kind &&
      previousData?.timeout?.isTimeout === edgeData.timeout?.isTimeout &&
      previousData?.timeout?.durationSeconds ===
        edgeData.timeout?.durationSeconds &&
      previousData?.conditionState === conditionState &&
      previous.source === edge.source &&
      previous.target === edge.target &&
      previous.style?.stroke === stroke &&
      previous.style?.strokeDasharray === finalStrokeDasharray &&
      previous.style?.opacity === finalOpacity &&
      previous.animated === isPathEdge
    ) {
      visible.push(previous);
      continue;
    }

    visible.push({
      ...edge,
      data: { ...edgeData, label: edgeLabel, kind, conditionState },
      animated: isPathEdge,
      style: {
        ...(edge.style || {}),
        stroke,
        strokeWidth: isPathEdge ? 2.5 : 1.5,
        strokeDasharray: finalStrokeDasharray,
        opacity: finalOpacity,
      },
      zIndex: isPathEdge ? 1000 : undefined,
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

  const explicitEntryIds = Array.from(nodeIds).filter(
    (id) =>
      id === "start" ||
      id === "label:start" ||
      id === "splashscreen" ||
      id === "main_menu" ||
      id === "before_main_menu" ||
      id === "after_load",
  );
  const roots = Array.from(nodeIds).filter((nodeId) =>
    (incomingCounts.get(nodeId) ?? 0) === 0
  );
  const startingSet = new Set([...explicitEntryIds, ...roots]);
  const traversalStarts = startingSet.size > 0
    ? Array.from(startingSet)
    : Array.from(nodeIds);
  const reachableNodeIds = new Set<string>();
  const stack = [...traversalStarts];
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
