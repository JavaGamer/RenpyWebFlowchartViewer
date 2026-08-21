import type { FlowEdge, FlowNode } from "../graph.ts";
import type { EndingType, ProjectNarrativeReport } from "../analytics.ts";
import {
  computeReverseReachability,
  discoverTerminalEndings,
  identifyPointsOfNoReturn,
} from "./endingReachability.ts";
import { enumerateStoryRoutes } from "./routeTraversal.ts";
import {
  computeChapterPacing,
  computeCharacterDistribution,
} from "./pacingAnalysis.ts";

function formatReadingTimeHelper(seconds: number): string {
  if (seconds <= 0) return "< 1m";
  const mins = Math.ceil(seconds / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const remainingMins = mins % 60;
  return remainingMins > 0 ? `${hours}h ${remainingMins}m` : `${hours}h`;
}

export function generateProjectNarrativeReport(
  nodes: FlowNode[],
  edges: FlowEdge[],
  options: {
    readingSpeedWpm?: number;
    customTags?: Record<string, EndingType>;
    maxRoutes?: number;
  } = {},
): ProjectNarrativeReport {
  const readingSpeedWpm = options.readingSpeedWpm ?? 200;
  const customTags = options.customTags ?? {};

  const nodeMap = new Map<string, FlowNode>();
  let totalUniqueStoryWords = 0;
  let totalUniquePause = 0;
  let totalDialogueLines = 0;
  let totalMenus = 0;

  for (const n of nodes) {
    nodeMap.set(n.id, n);
    if (!n.isOrphan) {
      totalUniqueStoryWords += n.wordCount ?? 0;
      totalUniquePause += n.pauseDuration ?? 0;
      totalDialogueLines += n.dialogueCount ?? 0;
    }
    if (n.type === "MENU") {
      totalMenus++;
    }
  }

  // 1. Discover Endings
  const { endingMap, reachableEndings, unreachableEndings } =
    discoverTerminalEndings(nodes, edges, customTags);

  // 2. Enumerate Routes
  const { routes, isTruncated } = enumerateStoryRoutes(
    nodes,
    edges,
    endingMap,
    {
      readingSpeedWpm,
      maxRoutes: options.maxRoutes,
    },
  );

  // 3. Compute Reverse Reachability & Points of No Return
  const allEndingIds = Array.from(endingMap.keys());
  const reachability = computeReverseReachability(nodes, edges, allEndingIds);
  const pointsOfNoReturn = identifyPointsOfNoReturn(
    nodes,
    edges,
    reachability,
    nodeMap,
  );

  // 4. Chapter Pacing & Monologues
  const chapterPacing = computeChapterPacing(nodes, edges, readingSpeedWpm);

  // 5. Character Dialogue Distribution
  const characterStats = computeCharacterDistribution(nodes);

  // 6. Summary Route Metrics
  let shortestRoute = routes.length > 0 ? routes[0]! : null;
  let longestRoute = routes.length > 0 ? routes[0]! : null;
  let totalRouteReadingSeconds = 0;

  for (const r of routes) {
    if (
      !shortestRoute || r.readingTimeSeconds < shortestRoute.readingTimeSeconds
    ) {
      shortestRoute = r;
    }
    if (
      !longestRoute || r.readingTimeSeconds > longestRoute.readingTimeSeconds
    ) {
      longestRoute = r;
    }
    totalRouteReadingSeconds += r.readingTimeSeconds;
  }

  const averageReadingTimeSeconds = routes.length > 0
    ? Math.round(totalRouteReadingSeconds / routes.length)
    : 0;

  const totalUniqueReadingTimeSeconds =
    (totalUniqueStoryWords / Math.max(1, readingSpeedWpm)) * 60 +
    totalUniquePause;

  let totalChoiceEdges = 0;
  for (const e of edges) {
    if (e.conditionIsStaticallyFalse) continue;
    const src = nodeMap.get(e.source);
    if (src && (src.type === "MENU" || Boolean(e.label))) {
      totalChoiceEdges++;
    }
  }

  const globalDialogueToChoiceRatio = totalMenus > 0
    ? Number((totalDialogueLines / totalMenus).toFixed(1))
    : totalDialogueLines;

  const globalBranchingFactor = totalMenus > 0
    ? Number((totalChoiceEdges / totalMenus).toFixed(2))
    : 0;

  return {
    totalEndings: endingMap.size,
    reachableEndings,
    unreachableEndings,
    totalRoutes: routes.length,
    routes,
    shortestRoute,
    longestRoute,
    averageReadingTimeSeconds,
    formattedAverageReadingTime: formatReadingTimeHelper(
      averageReadingTimeSeconds,
    ),
    totalUniqueStoryWords,
    totalUniqueReadingTimeSeconds,
    formattedTotalUniqueReadingTime: formatReadingTimeHelper(
      totalUniqueReadingTimeSeconds,
    ),
    globalDialogueToChoiceRatio,
    globalBranchingFactor,
    pointsOfNoReturn,
    chapterPacing,
    characterStats,
    isTruncated,
  };
}

export * from "./routeTraversal.ts";
export * from "./endingReachability.ts";
export * from "./pacingAnalysis.ts";
