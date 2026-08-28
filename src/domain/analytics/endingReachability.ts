import type { FlowEdge, FlowNode } from "../graph.ts";
import type {
  EndingSummary,
  EndingType,
  PointOfNoReturn,
} from "../analytics.ts";

export function classifyEndingTypeHeuristic(
  label?: string,
  node?: FlowNode,
): EndingType {
  const safeLabel = label ?? node?.label ?? "";
  const text = `${safeLabel} ${node?.dialogueLines?.join(" ") ?? ""}`
    .toLowerCase();

  if (
    /(?:^|_|\b)(true|best|perfect|golden)(?:_|\b|$)/i.test(safeLabel) ||
    /\b(true ending|true end)\b/i.test(text)
  ) {
    return "true";
  }
  if (
    /(?:^|_|\b)(good|happy|peaceful|victory|win)(?:_|\b|$)/i.test(safeLabel) ||
    /\b(good ending|good end|happily ever after)\b/i.test(text)
  ) {
    return "good";
  }
  if (
    /(?:^|_|\b)(gameover|game_over|dead|death|die|killed|failed|failure|trap)(?:_|\b|$)/i
      .test(safeLabel) ||
    /\b(game over|you died|killed)\b/i.test(text)
  ) {
    return "dead_end";
  }
  if (
    /(?:^|_|\b)(bad|evil|dark|tragedy|tragic|sad|worst|corrupt|doom)(?:_|\b|$)/i
      .test(safeLabel) ||
    /\b(bad ending|bad end)\b/i.test(text)
  ) {
    return "bad";
  }
  if (
    /(?:^|_|\b)(normal|neutral|default|standard)(?:_|\b|$)/i.test(safeLabel) ||
    /\b(normal ending|normal end)\b/i.test(text)
  ) {
    return "normal";
  }

  // If node has very low dialogue (< 3 dialogue lines) and has premature return/game over keywords
  if (
    node && node.dialogueCount <= 2 &&
    /(?:^|_|\b)(return|end)(?:_|\b|$)/i.test(safeLabel)
  ) {
    return "dead_end";
  }

  return "normal";
}

export function discoverTerminalEndings(
  nodes: FlowNode[],
  edges: FlowEdge[],
  customTags: Record<string, EndingType> = {},
): {
  endingMap: Map<string, EndingSummary>;
  reachableEndings: EndingSummary[];
  unreachableEndings: EndingSummary[];
} {
  const outgoingMap = new Map<string, FlowEdge[]>();
  for (const e of edges) {
    if (e.conditionIsStaticallyFalse) continue;
    let list = outgoingMap.get(e.source);
    if (!list) {
      list = [];
      outgoingMap.set(e.source, list);
    }
    list.push(e);
  }

  const endingMap = new Map<string, EndingSummary>();

  for (const node of nodes) {
    if (node.isShadowed) continue;

    const outgoing = outgoingMap.get(node.id) ?? [];
    const hasForwardFlow = outgoing.some(
      (e) =>
        e.kind === "sequence" || e.kind === "jump" || e.kind === "call" ||
        e.kind === "call_return",
    );

    const isTerminal = node.isTerminalOutcome === true ||
      (!hasForwardFlow && node.role === "story") ||
      (outgoing.length === 0);

    if (isTerminal) {
      const customTag = customTags[node.id];
      const endingType = customTag ??
        classifyEndingTypeHeuristic(node.label, node);

      const summary: EndingSummary = {
        nodeId: node.id,
        label: node.label || node.id,
        chapter: node.chapter,
        endingType,
        isTerminalOutcome: true,
        isOrphan: node.isOrphan === true,
        wordCount: node.wordCount ?? 0,
        pauseDuration: node.pauseDuration ?? 0,
        dialogueCount: node.dialogueCount ?? 0,
        totalReachableRoutes: 0,
        sourceLocation: node.sourceLocation,
      };

      endingMap.set(node.id, summary);
    }
  }

  const reachableEndings: EndingSummary[] = [];
  const unreachableEndings: EndingSummary[] = [];

  for (const ending of endingMap.values()) {
    if (ending.isOrphan) {
      unreachableEndings.push(ending);
    } else {
      reachableEndings.push(ending);
    }
  }

  return { endingMap, reachableEndings, unreachableEndings };
}

interface ReverseBfsState {
  nodeId: string;
  callStack: string[];
}

export function computeReverseReachability(
  nodes: FlowNode[],
  edges: FlowEdge[],
  endingIds: string[],
): Map<string, Set<string>> {
  // Map of node ID -> Set of reachable ending IDs
  const reachability = new Map<string, Set<string>>();
  for (const n of nodes) {
    reachability.set(n.id, new Set<string>());
  }

  // Reverse adjacency map: target -> incoming FlowEdge[]
  const incomingMap = new Map<string, FlowEdge[]>();
  for (const e of edges) {
    if (e.conditionIsStaticallyFalse) continue;
    let list = incomingMap.get(e.target);
    if (!list) {
      list = [];
      incomingMap.set(e.target, list);
    }
    list.push(e);
  }

  // Interprocedural reverse BFS from each terminal ending
  for (const endingId of endingIds) {
    const queue: ReverseBfsState[] = [{ nodeId: endingId, callStack: [] }];
    // State key: `${nodeId}::${callStack.join(",")}`
    const visited = new Set<string>([`${endingId}::`]);

    const targetSet = reachability.get(endingId);
    if (targetSet) targetSet.add(endingId);

    let reverseSteps = 0;
    while (queue.length > 0) {
      reverseSteps++;
      if (reverseSteps > 15000) break; // Circuit breaker against massive cyclic state explosion

      const { nodeId: curr, callStack } = queue.shift()!;
      const inEdges = incomingMap.get(curr) ?? [];

      for (const edge of inEdges) {
        const src = edge.source;
        let nextCallStack = callStack;

        // Backward traversal across subroutine boundaries:
        // 1. Moving backward across a `call_return` edge enters the subroutine from its return target.
        if (edge.kind === "call_return") {
          if (callStack.length >= 30) continue; // Cap recursion depth
          const ctxId = edge.callContext?.callContextId ?? edge.id;
          nextCallStack = [...callStack, ctxId];
        } // 2. Moving backward across a `call` edge exits the subroutine to the call site.
        else if (edge.kind === "call") {
          if (callStack.length > 0) {
            const expectedCtxId = edge.callContext?.callContextId;
            const topCtxId = callStack[callStack.length - 1];
            if (expectedCtxId && topCtxId !== expectedCtxId) {
              // Mismatched call site - prune this invalid reverse interprocedural path
              continue;
            }
            nextCallStack = callStack.slice(0, -1);
          }
        }

        const stateKey = `${src}::${nextCallStack.join(",")}`;
        if (!visited.has(stateKey)) {
          visited.add(stateKey);
          const sSet = reachability.get(src);
          if (sSet) sSet.add(endingId);
          queue.push({ nodeId: src, callStack: nextCallStack });
        }
      }
    }
  }

  return reachability;
}

export function identifyPointsOfNoReturn(
  _nodes: FlowNode[],
  edges: FlowEdge[],
  reachability: Map<string, Set<string>>,
  nodeMap: Map<string, FlowNode>,
): PointOfNoReturn[] {
  const ponrs: PointOfNoReturn[] = [];
  const seenEdgeIds = new Set<string>();

  for (const edge of edges) {
    if (edge.conditionIsStaticallyFalse) continue;
    if (seenEdgeIds.has(edge.id)) continue;

    const sourceNode = nodeMap.get(edge.source);
    const targetNode = nodeMap.get(edge.target);
    if (!sourceNode || !targetNode) continue;

    // We analyze choices/branches (e.g. from MENU or DECISION nodes, or labeled choice edges)
    const isChoiceBranch = sourceNode.type === "MENU" ||
      sourceNode.type === "DECISION" ||
      Boolean(edge.label) ||
      Boolean(edge.condition);

    if (!isChoiceBranch) continue;

    const sourceReach = reachability.get(sourceNode.id) ?? new Set<string>();
    const targetReach = reachability.get(targetNode.id) ?? new Set<string>();

    if (sourceReach.size <= 1) continue;

    // Calculate eliminated endings: Delta(e) = R(u) \ R(v)
    const eliminated: string[] = [];
    for (const endingId of sourceReach) {
      if (!targetReach.has(endingId)) {
        eliminated.push(endingId);
      }
    }

    if (eliminated.length > 0) {
      seenEdgeIds.add(edge.id);
      const isLockIn = targetReach.size === 1;

      ponrs.push({
        edgeId: edge.id,
        sourceNodeId: sourceNode.id,
        sourceNodeLabel: sourceNode.label || sourceNode.id,
        targetNodeId: targetNode.id,
        targetNodeLabel: targetNode.label || targetNode.id,
        choiceText: edge.label,
        conditionExpression: edge.condition?.expression,
        priorReachableEndingIds: Array.from(sourceReach),
        remainingReachableEndingIds: Array.from(targetReach),
        eliminatedEndingIds: eliminated,
        isEndingLockIn: isLockIn,
      });
    }
  }

  return ponrs;
}
