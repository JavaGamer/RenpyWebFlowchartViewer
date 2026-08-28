/**
 * src/domain/analytics/routeSolver.ts
 *
 * Automated pathfinding engine that finds optimal routes from story start
 * to any destination label/ending, accumulating required menu choices,
 * condition flag assignments, and reading stats.
 */

import type { CallContext, FlowEdge, FlowNode } from "../graph.ts";
import type { EndingType } from "../analytics.ts";
import { extractConditionFlagRefs } from "../conditionLogic.ts";
import { classifyEndingTypeHeuristic } from "./endingReachability.ts";

export type RouteSolverHeuristic =
  | "shortest_steps"
  | "least_choices"
  | "max_dialogue"
  | "all_paths";

export type SolvedStepType =
  | "start"
  | "choice"
  | "decision_branch"
  | "label"
  | "call"
  | "call_return"
  | "ending";

export interface SolvedStep {
  stepIndex: number;
  type: SolvedStepType;
  nodeId: string;
  nodeLabel: string;
  chapter?: string;
  choiceText?: string;
  menuNodeId?: string;
  menuLabel?: string;
  conditionExpression?: string;
  conditionReferences?: string[];
  edgeId?: string;
  dialogueCount: number;
  wordCount: number;
}

export interface SolvedWalkthrough {
  targetNodeId: string;
  targetLabel: string;
  isReachable: boolean;
  endingType?: EndingType;
  totalSteps: number;
  totalChoices: number;
  totalWordCount: number;
  totalPauseDuration: number;
  totalDialogueCount: number;
  readingTimeSeconds: number;
  formattedReadingTime: string;
  chaptersTraversed: string[];
  steps: SolvedStep[];
  nodeIds: string[];
  edgeIds: string[];
  flagsNeeded: Record<string, string | boolean>;
  alternativeRoutesCount: number;
}

export interface RouteSolverOptions {
  startNodeId?: string;
  targetNodeId: string;
  heuristic?: RouteSolverHeuristic;
  mockFlags?: Record<string, string>;
  maxDepth?: number;
  maxVisitedStates?: number;
  readingSpeedWpm?: number;
}

function formatReadingTimeHelper(seconds: number): string {
  if (seconds <= 0) return "< 1m";
  const mins = Math.ceil(seconds / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const remainingMins = mins % 60;
  return remainingMins > 0 ? `${hours}h ${remainingMins}m` : `${hours}h`;
}

interface PathState {
  nodeId: string;
  callStack: CallContext[];
  pathNodeIds: string[];
  pathEdgeIds: string[];
  steps: SolvedStep[];
  wordCount: number;
  pauseDuration: number;
  dialogueCount: number;
  traversedChapters: Set<string>;
  visitedNodeCounts: Map<string, number>;
  conditionExpressions: string[];
  choiceCount: number;
}

export function solveRouteToTarget(
  nodes: FlowNode[],
  edges: FlowEdge[],
  options: RouteSolverOptions,
): SolvedWalkthrough | null {
  const {
    startNodeId,
    targetNodeId,
    heuristic = "shortest_steps",
    maxDepth = 250,
    maxVisitedStates = 40000,
    readingSpeedWpm = 200,
  } = options;

  if (nodes.length === 0 || !targetNodeId) return null;

  const nodeMap = new Map<string, FlowNode>();
  for (const n of nodes) {
    nodeMap.set(n.id, n);
  }

  const targetNode = nodeMap.get(targetNodeId);
  if (!targetNode) return null;

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

  // Determine start / entry node(s)
  let entryNodeIds: string[] = [];
  if (startNodeId && nodeMap.has(startNodeId)) {
    entryNodeIds = [startNodeId];
  } else {
    const canonicalStart = nodes.find(
      (n) => n.id === "start" || n.label === "start",
    );
    if (canonicalStart) {
      entryNodeIds = [canonicalStart.id];
    } else {
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
  }

  const initialQueue: PathState[] = [];

  for (const entryId of entryNodeIds) {
    const entryNode = nodeMap.get(entryId);
    if (!entryNode) continue;

    const initialChapters = new Set<string>();
    if (entryNode.chapter) initialChapters.add(entryNode.chapter);

    const initialCounts = new Map<string, number>();
    initialCounts.set(entryId, 1);

    const initialStep: SolvedStep = {
      stepIndex: 1,
      type: "start",
      nodeId: entryNode.id,
      nodeLabel: entryNode.label,
      chapter: entryNode.chapter,
      dialogueCount: entryNode.dialogueCount ?? 0,
      wordCount: entryNode.wordCount ?? 0,
    };

    initialQueue.push({
      nodeId: entryId,
      callStack: [],
      pathNodeIds: [entryId],
      pathEdgeIds: [],
      steps: [initialStep],
      wordCount: entryNode.wordCount ?? 0,
      pauseDuration: entryNode.pauseDuration ?? 0,
      dialogueCount: entryNode.dialogueCount ?? 0,
      traversedChapters: initialChapters,
      visitedNodeCounts: initialCounts,
      conditionExpressions: [],
      choiceCount: 0,
    });
  }

  const foundPaths: PathState[] = [];
  let stateSteps = 0;
  const queue: PathState[] = initialQueue;
  let queueHead = 0;

  while (queueHead < queue.length) {
    stateSteps++;
    if (stateSteps > maxVisitedStates) break;

    const current = queue[queueHead++]!;
    const currNode = nodeMap.get(current.nodeId);

    if (current.nodeId === targetNodeId) {
      foundPaths.push(current);
      if (heuristic === "shortest_steps") {
        // In BFS, the first found path is optimal for step count
        break;
      }
      if (foundPaths.length >= (heuristic === "least_choices" ? 25 : 100)) {
        break;
      }
      continue;
    }

    if (current.pathNodeIds.length >= maxDepth) continue;

    const outgoing = outgoingMap.get(current.nodeId) ?? [];
    for (const edge of outgoing) {
      if (edge.kind === "call_return") {
        if (current.callStack.length === 0) {
          // Cannot return if call stack is empty
          continue;
        }
        const topCtx = current.callStack[current.callStack.length - 1]!;
        if (edge.callContext) {
          if (edge.callContext.callContextId !== topCtx.callContextId) {
            continue;
          }
        } else if (edge.target !== topCtx.returnTargetId) {
          continue;
        }
      }

      const target = nodeMap.get(edge.target);

      if (!target) continue;

      const visitCount = current.visitedNodeCounts.get(edge.target) ?? 0;
      // Disallow more than 1 cycle revisit per node
      if (visitCount >= 2) continue;

      const nextVisitedCounts = new Map(current.visitedNodeCounts);
      nextVisitedCounts.set(edge.target, visitCount + 1);

      const nextChapters = new Set(current.traversedChapters);
      if (target.chapter) nextChapters.add(target.chapter);

      const nextCallStack = [...current.callStack];
      if (edge.kind === "call" && edge.callContext) {
        nextCallStack.push(edge.callContext);
      } else if (edge.kind === "call_return" && nextCallStack.length > 0) {
        nextCallStack.pop();
      }

      const nextConditions = [...current.conditionExpressions];
      if (edge.condition?.expression) {
        nextConditions.push(edge.condition.expression);
      }

      let isChoice = false;
      let stepType: SolvedStepType = "label";
      if (currNode?.type === "MENU" || Boolean(edge.label)) {
        stepType = "choice";
        isChoice = true;
      } else if (edge.condition?.expression) {
        stepType = "decision_branch";
      } else if (edge.kind === "call") {
        stepType = "call";
      } else if (edge.kind === "call_return") {
        stepType = "call_return";
      } else if (target.id === targetNodeId) {
        stepType = "ending";
      }

      const nextStep: SolvedStep = {
        stepIndex: current.steps.length + 1,
        type: stepType,
        nodeId: target.id,
        nodeLabel: target.label,
        chapter: target.chapter,
        choiceText: edge.label,
        menuNodeId: currNode?.type === "MENU" ? currNode.id : undefined,
        menuLabel: currNode?.type === "MENU" ? currNode.label : undefined,
        conditionExpression: edge.condition?.expression,
        conditionReferences: edge.condition?.references,
        edgeId: edge.id,
        dialogueCount: target.dialogueCount ?? 0,
        wordCount: target.wordCount ?? 0,
      };

      queue.push({
        nodeId: edge.target,
        callStack: nextCallStack,
        pathNodeIds: [...current.pathNodeIds, edge.target],
        pathEdgeIds: [...current.pathEdgeIds, edge.id],
        steps: [...current.steps, nextStep],
        wordCount: current.wordCount + (target.wordCount ?? 0),
        pauseDuration: current.pauseDuration + (target.pauseDuration ?? 0),
        dialogueCount: current.dialogueCount + (target.dialogueCount ?? 0),
        traversedChapters: nextChapters,
        visitedNodeCounts: nextVisitedCounts,
        conditionExpressions: nextConditions,
        choiceCount: current.choiceCount + (isChoice ? 1 : 0),
      });
    }
  }

  if (foundPaths.length === 0) {
    return {
      targetNodeId: targetNode.id,
      targetLabel: targetNode.label,
      isReachable: false,
      endingType: classifyEndingTypeHeuristic(targetNode.label, targetNode),
      totalSteps: 0,
      totalChoices: 0,
      totalWordCount: 0,
      totalPauseDuration: 0,
      totalDialogueCount: 0,
      readingTimeSeconds: 0,
      formattedReadingTime: "< 1m",
      chaptersTraversed: [],
      steps: [],
      nodeIds: [],
      edgeIds: [],
      flagsNeeded: {},
      alternativeRoutesCount: 0,
    };
  }

  // Sort paths based on requested heuristic
  foundPaths.sort((a, b) => {
    if (heuristic === "least_choices") {
      return a.choiceCount - b.choiceCount ||
        a.pathNodeIds.length - b.pathNodeIds.length;
    }
    if (heuristic === "max_dialogue") {
      return b.wordCount - a.wordCount ||
        a.pathNodeIds.length - b.pathNodeIds.length;
    }
    // Default: shortest steps
    return a.pathNodeIds.length - b.pathNodeIds.length ||
      a.choiceCount - b.choiceCount;
  });

  const best = foundPaths[0]!;

  // Deduce flags needed from condition expressions along the path
  const flagsNeeded: Record<string, string | boolean> = {};
  for (const expr of best.conditionExpressions) {
    const refs = extractConditionFlagRefs(expr);
    for (const ref of refs) {
      if (ref && !(ref in flagsNeeded)) {
        // Infer default expected truthiness if simple variable
        if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(expr.trim())) {
          flagsNeeded[ref] = true;
        } else {
          flagsNeeded[ref] = expr;
        }
      }
    }
  }

  const readingTimeSeconds =
    (best.wordCount / Math.max(1, readingSpeedWpm)) * 60 +
    best.pauseDuration;

  return {
    targetNodeId: targetNode.id,
    targetLabel: targetNode.label,
    isReachable: true,
    endingType: classifyEndingTypeHeuristic(targetNode.label, targetNode),
    totalSteps: best.steps.length,
    totalChoices: best.choiceCount,
    totalWordCount: best.wordCount,
    totalPauseDuration: best.pauseDuration,
    totalDialogueCount: best.dialogueCount,
    readingTimeSeconds,
    formattedReadingTime: formatReadingTimeHelper(readingTimeSeconds),
    chaptersTraversed: Array.from(best.traversedChapters),
    steps: best.steps,
    nodeIds: best.pathNodeIds,
    edgeIds: best.pathEdgeIds,
    flagsNeeded,
    alternativeRoutesCount: foundPaths.length,
  };
}
