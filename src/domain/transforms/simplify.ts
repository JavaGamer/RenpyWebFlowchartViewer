import type { FlowNode, FlowEdge, EdgeKind, ConditionMetadata, TimeoutMetadata } from "../graph.ts";

export interface GraphSimplificationOptions {
  collapseLinearChains: boolean;
  inlineUtilities: boolean;
  inlineDetours: boolean;
  inlineStateToggles: boolean;
  inlineEmptyLabels: boolean;
  inlineDialogueThreshold: number;
}

/**
 * Simplifies the node graph by inlining specified roles or empty labels,
 * and collapsing consecutive 1-to-1 linear chains.
 */
export function simplifyGraph(
  nodes: FlowNode[],
  edges: FlowEdge[],
  options: GraphSimplificationOptions
): { nodes: FlowNode[]; edges: FlowEdge[] } {
  let currentNodes = [...nodes];
  let currentEdges = [...edges];

  // 1. Inlining pass
  if (
    options.inlineUtilities ||
    options.inlineDetours ||
    options.inlineStateToggles ||
    options.inlineEmptyLabels
  ) {
    const { nodes: inlinedNodes, edges: inlinedEdges } = inlineNodes(
      currentNodes,
      currentEdges,
      options
    );
    currentNodes = inlinedNodes;
    currentEdges = inlinedEdges;
  }

  // 2. Collapsing pass
  if (options.collapseLinearChains) {
    const { nodes: collapsedNodes, edges: collapsedEdges } = collapseLinearChains(
      currentNodes,
      currentEdges
    );
    currentNodes = collapsedNodes;
    currentEdges = collapsedEdges;
  }

  return { nodes: currentNodes, edges: currentEdges };
}

function inlineNodes(
  nodes: FlowNode[],
  edges: FlowEdge[],
  options: GraphSimplificationOptions
): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const H = new Set<string>();

  // Count incoming edges per node (excluding self-loops)
  const incomingCounts = new Map<string, number>();
  for (const edge of edges) {
    if (edge.source === edge.target) continue;
    incomingCounts.set(edge.target, (incomingCounts.get(edge.target) ?? 0) + 1);
  }

  for (const node of nodes) {
    if (node.type !== "LABEL") continue;

    // Protect entry start node
    const isStartNode = node.id === "start" || node.label.toLowerCase() === "start";
    if (isStartNode) continue;

    // Protect terminal outcomes (end of routes)
    if (node.isTerminalOutcome) continue;

    // Protect root nodes (no incoming edges)
    const incomingCount = incomingCounts.get(node.id) ?? 0;
    if (incomingCount === 0) continue;

    let shouldInline = false;
    if (options.inlineUtilities && node.role === "utility") {
      shouldInline = true;
    } else if (options.inlineDetours && node.role === "detour") {
      shouldInline = true;
    } else if (options.inlineStateToggles && node.role === "state_toggle") {
      shouldInline = true;
    } else if (
      options.inlineEmptyLabels &&
      options.inlineDialogueThreshold !== undefined &&
      node.dialogueCount < options.inlineDialogueThreshold
    ) {
      shouldInline = true;
    }

    if (shouldInline) {
      H.add(node.id);
    }
  }

  if (H.size === 0) {
    return { nodes, edges };
  }

  const nodesMap = new Map(nodes.map((n) => [n.id, n]));
  const outgoingEdges = new Map<string, FlowEdge[]>();
  for (const edge of edges) {
    const list = outgoingEdges.get(edge.source) || [];
    list.push(edge);
    outgoingEdges.set(edge.source, list);
  }

  const newEdges: FlowEdge[] = [];

  for (const u of nodes) {
    if (H.has(u.id)) continue;

    const queue: Array<{
      nodeId: string;
      label: string;
      kind: EdgeKind | undefined;
      condition: ConditionMetadata | undefined;
      timeout: TimeoutMetadata | undefined;
      originalId?: string;
      isInlinedPath: boolean;
    }> = [];

    const initialEdges = outgoingEdges.get(u.id) || [];
    for (const edge of initialEdges) {
      queue.push({
        nodeId: edge.target,
        label: edge.label || "",
        kind: edge.kind,
        condition: edge.condition,
        timeout: edge.timeout,
        originalId: edge.id,
        isInlinedPath: false,
      });
    }

    const visited = new Set<string>();

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current.nodeId)) continue;
      visited.add(current.nodeId);

      const targetNode = nodesMap.get(current.nodeId);
      if (!targetNode) {
        newEdges.push({
          id: current.isInlinedPath
            ? `${current.kind || "sequence"}_${u.id}__${current.nodeId}__inlined_${current.label}`
            : current.originalId!,
          source: u.id,
          target: current.nodeId,
          kind: current.kind,
          label: current.label || undefined,
          condition: current.condition,
          timeout: current.timeout,
        });
        continue;
      }

      if (!H.has(current.nodeId)) {
        newEdges.push({
          id: current.isInlinedPath
            ? `${current.kind || "sequence"}_${u.id}__${current.nodeId}__inlined_${current.label || ""}_${current.condition?.expression || ""}`
            : current.originalId!,
          source: u.id,
          target: current.nodeId,
          kind: current.kind,
          label: current.label || undefined,
          condition: current.condition,
          timeout: current.timeout,
        });
      } else {
        const nextEdges = outgoingEdges.get(current.nodeId) || [];
        for (const edge of nextEdges) {
          const mergedLabel = current.label || edge.label || "";
          
          let mergedKind = current.kind;
          if (edge.kind === "call_return" || mergedKind === "call_return") {
            mergedKind = "call_return";
          } else if (edge.kind === "call" || mergedKind === "call") {
            mergedKind = "call";
          } else if (edge.kind === "jump" || mergedKind === "jump") {
            mergedKind = "jump";
          } else {
            mergedKind = "sequence";
          }

          const mergedCondition = current.condition || edge.condition;
          const mergedTimeout = current.timeout || edge.timeout;

          queue.push({
            nodeId: edge.target,
            label: mergedLabel,
            kind: mergedKind,
            condition: mergedCondition,
            timeout: mergedTimeout,
            isInlinedPath: true,
          });
        }
      }
    }
  }

  const remainingNodes = nodes.filter((n) => !H.has(n.id));

  return { nodes: remainingNodes, edges: newEdges };
}

function collapseLinearChains(
  nodes: FlowNode[],
  edges: FlowEdge[]
): { nodes: FlowNode[]; edges: FlowEdge[] } {
  let currentNodes = [...nodes];
  let currentEdges = [...edges];

  let changed = true;
  while (changed) {
    changed = false;

    // Build adjacency maps
    const incoming = new Map<string, FlowEdge[]>();
    const outgoing = new Map<string, FlowEdge[]>();
    for (const edge of currentEdges) {
      const inc = incoming.get(edge.target) || [];
      inc.push(edge);
      incoming.set(edge.target, inc);

      const out = outgoing.get(edge.source) || [];
      out.push(edge);
      outgoing.set(edge.source, out);
    }

    const nodeMap = new Map(currentNodes.map((n) => [n.id, n]));

    let pairToMerge: { sourceId: string; targetId: string; edge: FlowEdge } | null = null;
    for (const edge of currentEdges) {
      const A = nodeMap.get(edge.source);
      const B = nodeMap.get(edge.target);

      if (!A || !B) continue;
      if (A.type !== "LABEL" || B.type !== "LABEL") continue;
      if (A.chapter !== B.chapter) continue;
      if (A.id === "start" || B.id === "start") continue;

      const outA = outgoing.get(A.id) || [];
      const incB = incoming.get(B.id) || [];

      // Merge B into A if A has exactly B as its single target,
      // and B has exactly A as its single source, with no conditional branch
      if (outA.length === 1 && incB.length === 1) {
        if (
          !edge.label &&
          !edge.condition &&
          !edge.timeout &&
          (edge.kind === "sequence" || edge.kind === "jump")
        ) {
          pairToMerge = { sourceId: A.id, targetId: B.id, edge };
          break;
        }
      }
    }

    if (pairToMerge) {
      const { sourceId, targetId, edge } = pairToMerge;
      const A = nodeMap.get(sourceId)!;
      const B = nodeMap.get(targetId)!;

      const mergedNode: FlowNode = {
        ...A,
        label: A.label,
        dialogueCount: A.dialogueCount + B.dialogueCount,
        dialogueLines: [...(A.dialogueLines || []), ...(B.dialogueLines || [])],
        dialogueLineNums: [...(A.dialogueLineNums || []), ...(B.dialogueLineNums || [])],
        audioAssetCues: [...(A.audioAssetCues || []), ...(B.audioAssetCues || [])],
        isShadowed: A.isShadowed || B.isShadowed,
        isTerminalOutcome: B.isTerminalOutcome,
        collapsedLabels: [...(A.collapsedLabels || []), B.label],
      };

      currentNodes = currentNodes
        .filter((n) => n.id !== targetId)
        .map((n) => (n.id === sourceId ? mergedNode : n));

      currentEdges = currentEdges
        .filter((e) => e.id !== edge.id)
        .map((e) => {
          if (e.source === targetId) {
            return {
              ...e,
              id: `${e.kind || "sequence"}_${sourceId}__${e.target}__collapsed`,
              source: sourceId,
            };
          }
          return e;
        });

      changed = true;
    }
  }

  return { nodes: currentNodes, edges: currentEdges };
}
