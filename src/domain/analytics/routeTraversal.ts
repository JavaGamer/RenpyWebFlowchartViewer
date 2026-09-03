import type { CallContext, FlowEdge, FlowNode } from "../graph.ts";
import type {
  EndingSummary,
  RouteChoiceStep,
  StoryRoute,
} from "../analytics.ts";

export interface TraversalOptions {
  maxRoutes?: number;
  maxDepth?: number;
  maxVisitedStates?: number;
  readingSpeedWpm?: number;
}

const DEFAULT_MAX_ROUTES = 500;
const DEFAULT_MAX_DEPTH = 200;
const DEFAULT_MAX_VISITED_STATES = 50000;
const DEFAULT_READING_SPEED_WPM = 200;

function formatReadingTimeHelper(seconds: number): string {
  if (seconds <= 0) return "< 1m";
  const mins = Math.ceil(seconds / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const remainingMins = mins % 60;
  return remainingMins > 0 ? `${hours}h ${remainingMins}m` : `${hours}h`;
}

function calculateReadingTime(
  words: number,
  pauseSeconds: number,
  wpm: number,
): number {
  const effectiveWpm = Math.max(1, wpm);
  return (words / effectiveWpm) * 60 + pauseSeconds;
}

export function enumerateStoryRoutes(
  nodes: FlowNode[],
  edges: FlowEdge[],
  endingMap: Map<string, EndingSummary>,
  options: TraversalOptions = {},
): { routes: StoryRoute[]; isTruncated: boolean } {
  const maxRoutes = options.maxRoutes ?? DEFAULT_MAX_ROUTES;
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const maxVisitedStates = options.maxVisitedStates ??
    DEFAULT_MAX_VISITED_STATES;
  const readingSpeedWpm = options.readingSpeedWpm ?? DEFAULT_READING_SPEED_WPM;

  const nodeMap = new Map<string, FlowNode>();
  for (const n of nodes) {
    nodeMap.set(n.id, n);
  }

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

  // Find start / entry points
  const canonicalStart = nodes.find((n) =>
    n.id === "start" || n.label === "start"
  );
  let entryNodeIds: string[] = [];

  if (canonicalStart) {
    entryNodeIds = [canonicalStart.id];
  } else {
    // Collect all story nodes with 0 incoming edges
    const incomingCount = new Map<string, number>();
    for (const e of edges) {
      if (e.conditionIsStaticallyFalse) continue;
      incomingCount.set(e.target, (incomingCount.get(e.target) ?? 0) + 1);
    }
    for (const n of nodes) {
      if (n.role === "story" && (incomingCount.get(n.id) ?? 0) === 0) {
        entryNodeIds.push(n.id);
      }
    }
    if (entryNodeIds.length === 0 && nodes.length > 0) {
      entryNodeIds = [nodes[0]!.id];
    }
  }

  const routes: StoryRoute[] = [];
  let isTruncated = false;
  let stateSteps = 0;

  interface StackFrame {
    nodeId: string;
    callStack: CallContext[];
    pathNodeIds: string[];
    pathEdgeIds: string[];
    choices: RouteChoiceStep[];
    wordCount: number;
    pauseDuration: number;
    dialogueCount: number;
    traversedChapters: Set<string>;
    visitedNodeCounts: Map<string, number>;
  }

  for (const entryId of entryNodeIds) {
    if (
      routes.length >= maxRoutes || stateSteps > maxVisitedStates || isTruncated
    ) {
      isTruncated = true;
      break;
    }

    const entryNode = nodeMap.get(entryId);
    if (!entryNode) continue;

    const initialChapters = new Set<string>();
    if (entryNode.chapter) initialChapters.add(entryNode.chapter);

    const initialCounts = new Map<string, number>();
    initialCounts.set(entryId, 1);

    const stack: StackFrame[] = [{
      nodeId: entryId,
      callStack: [],
      pathNodeIds: [entryId],
      pathEdgeIds: [],
      choices: [],
      wordCount: entryNode.wordCount ?? 0,
      pauseDuration: entryNode.pauseDuration ?? 0,
      dialogueCount: entryNode.dialogueCount ?? 0,
      traversedChapters: initialChapters,
      visitedNodeCounts: initialCounts,
    }];

    while (stack.length > 0) {
      stateSteps++;
      if (stateSteps > maxVisitedStates || routes.length >= maxRoutes) {
        isTruncated = true;
        break;
      }

      const current = stack.pop()!;
      const currNode = nodeMap.get(current.nodeId);
      const isTerminal = endingMap.has(current.nodeId);

      // Check if this node is an ending or has no outgoing edges
      const outgoing = outgoingMap.get(current.nodeId) ?? [];
      const validOutgoing: FlowEdge[] = [];

      for (const e of outgoing) {
        if (e.kind === "call_return") {
          // If we have an active call stack, only match the matching call context
          if (current.callStack.length > 0) {
            const topCtx = current.callStack[current.callStack.length - 1]!;
            if (
              !e.callContext ||
              e.callContext.callContextId === topCtx.callContextId ||
              e.target === topCtx.returnTargetId
            ) {
              validOutgoing.push(e);
            }
          }
        } else {
          validOutgoing.push(e);
        }
      }

      if (isTerminal || validOutgoing.length === 0) {
        const endingSummary = endingMap.get(current.nodeId) ?? {
          nodeId: current.nodeId,
          label: currNode?.label ?? current.nodeId,
          chapter: currNode?.chapter,
          endingType: "normal" as const,
          isTerminalOutcome: true,
          isOrphan: currNode?.isOrphan === true,
          wordCount: currNode?.wordCount ?? 0,
          pauseDuration: currNode?.pauseDuration ?? 0,
          dialogueCount: currNode?.dialogueCount ?? 0,
          totalReachableRoutes: 0,
          sourceLocation: currNode?.sourceLocation,
        };

        const readingTimeSeconds = calculateReadingTime(
          current.wordCount,
          current.pauseDuration,
          readingSpeedWpm,
        );

        let hasCycle = false;
        for (const count of current.visitedNodeCounts.values()) {
          if (count > 1) {
            hasCycle = true;
            break;
          }
        }

        routes.push({
          routeId: `route_${routes.length + 1}`,
          terminalEnding: endingSummary,
          nodeIds: [...current.pathNodeIds],
          edgeIds: [...current.pathEdgeIds],
          choices: [...current.choices],
          wordCount: current.wordCount,
          pauseDuration: current.pauseDuration,
          dialogueCount: current.dialogueCount,
          readingTimeSeconds,
          formattedReadingTime: formatReadingTimeHelper(readingTimeSeconds),
          chaptersTraversed: Array.from(current.traversedChapters),
          hasCycle,
        });

        if (routes.length >= maxRoutes) {
          isTruncated = true;
          break;
        }

        if (isTerminal && validOutgoing.length === 0) {
          continue;
        }
      }

      if (current.pathNodeIds.length >= maxDepth) {
        continue;
      }

      for (const edge of validOutgoing) {
        const targetNode = nodeMap.get(edge.target);
        if (!targetNode) continue;

        const visitCount = current.visitedNodeCounts.get(edge.target) ?? 0;
        // Bounded cycle unrolling (at most 1 cycle revisit per node)
        if (visitCount >= 2) continue;

        const nextVisitedCounts = new Map(current.visitedNodeCounts);
        nextVisitedCounts.set(edge.target, visitCount + 1);

        const nextChapters = new Set(current.traversedChapters);
        if (targetNode.chapter) nextChapters.add(targetNode.chapter);

        const nextCallStack = [...current.callStack];
        if (edge.kind === "call") {
          const ctx = edge.callContext ?? {
            callContextId: edge.id,
            callEdgeId: edge.id,
            callSiteId: edge.source,
            returnTargetId: edge.target,
          };
          nextCallStack.push(ctx);
        } else if (edge.kind === "call_return" && nextCallStack.length > 0) {
          nextCallStack.pop();
        }

        const nextChoices = [...current.choices];
        if (currNode && (currNode.type === "MENU" || Boolean(edge.label))) {
          nextChoices.push({
            menuNodeId: currNode.id,
            menuLabel: currNode.label,
            edgeId: edge.id,
            choiceText: edge.label,
            targetNodeId: targetNode.id,
            targetNodeLabel: targetNode.label,
            conditionExpression: edge.condition?.expression,
          });
        }

        stack.push({
          nodeId: edge.target,
          callStack: nextCallStack,
          pathNodeIds: [...current.pathNodeIds, edge.target],
          pathEdgeIds: [...current.pathEdgeIds, edge.id],
          choices: nextChoices,
          wordCount: current.wordCount + (targetNode.wordCount ?? 0),
          pauseDuration: current.pauseDuration +
            (targetNode.pauseDuration ?? 0),
          dialogueCount: current.dialogueCount +
            (targetNode.dialogueCount ?? 0),
          traversedChapters: nextChapters,
          visitedNodeCounts: nextVisitedCounts,
        });
      }
    }
  }

  // Update total reachable routes on ending summaries
  for (const r of routes) {
    const ending = endingMap.get(r.terminalEnding.nodeId);
    if (ending) {
      ending.totalReachableRoutes++;
    }
  }

  return { routes, isTruncated };
}
