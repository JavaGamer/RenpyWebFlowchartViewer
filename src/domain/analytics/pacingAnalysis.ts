import type { FlowEdge, FlowNode } from "../graph.ts";
import type {
  ChapterPacingStats,
  CharacterPacingStats,
  MonologueSection,
} from "../analytics.ts";

const DEFAULT_MONOLOGUE_LINE_THRESHOLD = 30;
const DEFAULT_MONOLOGUE_WORD_THRESHOLD = 500;

function formatReadingTimeHelper(seconds: number): string {
  if (seconds <= 0) return "< 1m";
  const mins = Math.ceil(seconds / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const remainingMins = mins % 60;
  return remainingMins > 0 ? `${hours}h ${remainingMins}m` : `${hours}h`;
}

export function computeMonologueSections(
  nodes: FlowNode[],
  edges: FlowEdge[],
  readingSpeedWpm = 200,
): MonologueSection[] {
  const nodeMap = new Map<string, FlowNode>();
  for (const n of nodes) nodeMap.set(n.id, n);

  const outgoingMap = new Map<string, FlowEdge[]>();
  const incomingMap = new Map<string, FlowEdge[]>();
  for (const e of edges) {
    if (e.conditionIsStaticallyFalse) continue;
    let outList = outgoingMap.get(e.source);
    if (!outList) {
      outList = [];
      outgoingMap.set(e.source, outList);
    }
    outList.push(e);

    let inList = incomingMap.get(e.target);
    if (!inList) {
      inList = [];
      incomingMap.set(e.target, inList);
    }
    inList.push(e);
  }

  // Find maximal linear chains of LABEL story nodes with outDeg=1 and inDeg=1
  const visitedNodes = new Set<string>();
  const sections: MonologueSection[] = [];

  for (const node of nodes) {
    if (visitedNodes.has(node.id)) continue;
    if (node.type !== "LABEL" || node.role !== "story") continue;

    // Check if this node is a standalone single node with high dialogue or start of a chain
    const chain: FlowNode[] = [node];
    visitedNodes.add(node.id);

    // Expand backwards if linear
    let prev = incomingMap.get(chain[0]!.id);
    while (
      prev && prev.length === 1 &&
      (prev[0]!.kind === "sequence" || prev[0]!.kind === "jump") &&
      !prev[0]!.label &&
      !prev[0]!.condition &&
      nodeMap.get(prev[0]!.source)?.type === "LABEL" &&
      nodeMap.get(prev[0]!.source)?.role === "story" &&
      (outgoingMap.get(prev[0]!.source) ?? []).length === 1 &&
      !visitedNodes.has(prev[0]!.source)
    ) {
      const srcNode = nodeMap.get(prev[0]!.source)!;
      chain.unshift(srcNode);
      visitedNodes.add(srcNode.id);
      prev = incomingMap.get(srcNode.id);
    }

    // Expand forwards if linear
    let next = outgoingMap.get(chain[chain.length - 1]!.id);
    while (
      next && next.length === 1 &&
      (next[0]!.kind === "sequence" || next[0]!.kind === "jump") &&
      !next[0]!.label &&
      !next[0]!.condition &&
      nodeMap.get(next[0]!.target)?.type === "LABEL" &&
      nodeMap.get(next[0]!.target)?.role === "story" &&
      (incomingMap.get(next[0]!.target) ?? []).length === 1 &&
      !visitedNodes.has(next[0]!.target)
    ) {
      const tgtNode = nodeMap.get(next[0]!.target)!;
      chain.push(tgtNode);
      visitedNodes.add(tgtNode.id);
      next = outgoingMap.get(tgtNode.id);
    }

    const totalLines = chain.reduce(
      (acc, n) => acc + (n.dialogueCount ?? 0),
      0,
    );
    const totalWords = chain.reduce((acc, n) => acc + (n.wordCount ?? 0), 0);
    const totalPause = chain.reduce(
      (acc, n) => acc + (n.pauseDuration ?? 0),
      0,
    );

    if (
      totalLines >= DEFAULT_MONOLOGUE_LINE_THRESHOLD ||
      totalWords >= DEFAULT_MONOLOGUE_WORD_THRESHOLD
    ) {
      const firstNode = chain[0]!;
      const lastNode = chain[chain.length - 1]!;
      const readingTimeSeconds =
        (totalWords / Math.max(1, readingSpeedWpm)) * 60 +
        totalPause;
      const locations = chain
        .map((n) => n.sourceLocation)
        .filter((l): l is NonNullable<typeof l> => Boolean(l));

      sections.push({
        id: `monologue_${firstNode.id}_${lastNode.id}`,
        chapter: firstNode.chapter ?? "Uncategorized",
        startNodeId: firstNode.id,
        startNodeLabel: firstNode.label,
        endNodeId: lastNode.id,
        endNodeLabel: lastNode.label,
        nodeCount: chain.length,
        dialogueLineCount: totalLines,
        wordCount: totalWords,
        readingTimeSeconds,
        formattedReadingTime: formatReadingTimeHelper(readingTimeSeconds),
        sourceLocations: locations,
      });
    }
  }

  return sections;
}

export function computeChapterPacing(
  nodes: FlowNode[],
  edges: FlowEdge[],
  readingSpeedWpm = 200,
): Record<string, ChapterPacingStats> {
  const byChapter = new Map<string, {
    nodes: FlowNode[];
    edges: FlowEdge[];
  }>();

  for (const n of nodes) {
    const ch = n.chapter ?? "Uncategorized";
    let entry = byChapter.get(ch);
    if (!entry) {
      entry = { nodes: [], edges: [] };
      byChapter.set(ch, entry);
    }
    entry.nodes.push(n);
  }

  const monologueSections = computeMonologueSections(
    nodes,
    edges,
    readingSpeedWpm,
  );
  const monologueByChapter = new Map<string, MonologueSection[]>();
  for (const m of monologueSections) {
    let list = monologueByChapter.get(m.chapter);
    if (!list) {
      list = [];
      monologueByChapter.set(m.chapter, list);
    }
    list.push(m);
  }

  const nodeMap = new Map<string, FlowNode>();
  for (const n of nodes) {
    nodeMap.set(n.id, n);
  }

  const choicesByChapter = new Map<string, number>();
  for (const e of edges) {
    if (e.conditionIsStaticallyFalse) continue;
    const srcNode = nodeMap.get(e.source);
    if (srcNode && (srcNode.type === "MENU" || Boolean(e.label))) {
      const ch = srcNode.chapter || "Uncategorized";
      choicesByChapter.set(ch, (choicesByChapter.get(ch) ?? 0) + 1);
    }
  }

  const result: Record<string, ChapterPacingStats> = {};

  for (const [chapter, { nodes: chNodes }] of byChapter.entries()) {
    let totalLines = 0;
    let totalWords = 0;
    let totalPause = 0;
    let totalMenus = 0;
    const totalChoices = choicesByChapter.get(chapter) ?? 0;

    for (const n of chNodes) {
      totalLines += n.dialogueCount ?? 0;
      totalWords += n.wordCount ?? 0;
      totalPause += n.pauseDuration ?? 0;

      if (n.type === "MENU") {
        totalMenus++;
      }
    }

    const dialogueToChoiceRatio = totalMenus > 0
      ? Number((totalLines / totalMenus).toFixed(1))
      : totalLines;

    const readingTimeSeconds =
      (totalWords / Math.max(1, readingSpeedWpm)) * 60 +
      totalPause;
    const chapterMonologues = monologueByChapter.get(chapter) ?? [];

    let longestLines = 0;
    let longestWords = 0;
    for (const m of chapterMonologues) {
      if (m.dialogueLineCount > longestLines) {
        longestLines = m.dialogueLineCount;
      }
      if (m.wordCount > longestWords) longestWords = m.wordCount;
    }

    result[chapter] = {
      chapter,
      totalDialogueLines: totalLines,
      totalWordCount: totalWords,
      totalMenus,
      totalChoices,
      dialogueToChoiceRatio,
      readingTimeSeconds,
      formattedReadingTime: formatReadingTimeHelper(readingTimeSeconds),
      monologueSections: chapterMonologues,
      longestMonologueLines: longestLines,
      longestMonologueWords: longestWords,
    };
  }

  return result;
}

export function computeCharacterDistribution(
  nodes: FlowNode[],
): CharacterPacingStats[] {
  const charStatsMap = new Map<
    string,
    { lineCount: number; wordCount: number }
  >();
  let totalProjectLines = 0;
  let totalProjectWords = 0;

  for (const node of nodes) {
    if (node.characterDialogue) {
      for (const [speaker, stats] of Object.entries(node.characterDialogue)) {
        let entry = charStatsMap.get(speaker);
        if (!entry) {
          entry = { lineCount: 0, wordCount: 0 };
          charStatsMap.set(speaker, entry);
        }
        entry.lineCount += stats.lineCount;
        entry.wordCount += stats.wordCount;
        totalProjectLines += stats.lineCount;
        totalProjectWords += stats.wordCount;
      }
    } else if (node.dialogueCount > 0) {
      // Fallback narrator for nodes without speaker breakdown
      const narratorKey = "narrator";
      let entry = charStatsMap.get(narratorKey);
      if (!entry) {
        entry = { lineCount: 0, wordCount: 0 };
        charStatsMap.set(narratorKey, entry);
      }
      entry.lineCount += node.dialogueCount;
      entry.wordCount += node.wordCount ?? 0;
      totalProjectLines += node.dialogueCount;
      totalProjectWords += node.wordCount ?? 0;
    }
  }

  const results: CharacterPacingStats[] = [];

  for (const [speaker, stats] of charStatsMap.entries()) {
    const linePct = totalProjectLines > 0
      ? Number(((stats.lineCount / totalProjectLines) * 100).toFixed(1))
      : 0;
    const wordPct = totalProjectWords > 0
      ? Number(((stats.wordCount / totalProjectWords) * 100).toFixed(1))
      : 0;

    results.push({
      speaker,
      lineCount: stats.lineCount,
      wordCount: stats.wordCount,
      percentageOfLines: linePct,
      percentageOfWords: wordPct,
    });
  }

  // Sort descending by word count
  results.sort((a, b) => b.wordCount - a.wordCount);
  return results;
}
