import type { FlowEdge, FlowNode } from "../graph.ts";

export const CHAPTER_NODE_PREFIX = "chapter:";

export function getChapterId(chapterName: string): string {
  return `${CHAPTER_NODE_PREFIX}${chapterName}`;
}

export function isChapterId(id: string): boolean {
  return id.startsWith(CHAPTER_NODE_PREFIX);
}

export function extractChapterName(chapterId: string): string {
  return chapterId.startsWith(CHAPTER_NODE_PREFIX)
    ? chapterId.slice(CHAPTER_NODE_PREFIX.length)
    : chapterId;
}

export interface ChapterAggregates {
  chapter: string;
  nodeCount: number;
  dialogueCount: number;
  wordCount: number;
  pauseDuration: number;
  labelCount: number;
  menuCount: number;
  decisionCount: number;
}

/**
 * Groups an array of FlowNodes by chapter name.
 * If a node lacks a chapter property, it is placed in "Uncategorized".
 */
export function groupNodesByChapter(
  nodes: FlowNode[],
): Map<string, FlowNode[]> {
  const groups = new Map<string, FlowNode[]>();
  for (const node of nodes) {
    const chapter = node.chapter || "Uncategorized";
    let list = groups.get(chapter);
    if (!list) {
      list = [];
      groups.set(chapter, list);
    }
    list.push(node);
  }
  return groups;
}

/**
 * Computes aggregate metrics (nodes, dialogue lines, words, pause duration) for each chapter.
 */
export function computeChapterAggregates(
  nodes: FlowNode[],
  precomputedGroups?: Map<string, FlowNode[]>,
): Map<string, ChapterAggregates> {
  const aggregates = new Map<string, ChapterAggregates>();
  const groups = precomputedGroups ?? groupNodesByChapter(nodes);

  for (const [chapter, chapterNodes] of groups.entries()) {
    let dialogueCount = 0;
    let wordCount = 0;
    let pauseDuration = 0;
    let labelCount = 0;
    let menuCount = 0;
    let decisionCount = 0;

    for (const node of chapterNodes) {
      dialogueCount += node.dialogueCount || 0;
      wordCount += node.wordCount || 0;
      pauseDuration += node.pauseDuration || 0;
      if (node.type === "LABEL") labelCount += 1;
      else if (node.type === "MENU") menuCount += 1;
      else if (node.type === "DECISION") decisionCount += 1;
    }

    aggregates.set(chapter, {
      chapter,
      nodeCount: chapterNodes.length,
      dialogueCount,
      wordCount,
      pauseDuration,
      labelCount,
      menuCount,
      decisionCount,
    });
  }

  return aggregates;
}

/**
 * Re-routes edges when one or both endpoints belong to a collapsed chapter container.
 * - Suppresses intra-chapter edges where both endpoints belong to the same collapsed chapter.
 * - Bubbles external incident edges to connect to the chapter summary node ID.
 * - Deduplicates redundant parallel edges created by edge redirection.
 */
export function redirectEdgesForCollapsedChapters(
  edges: FlowEdge[],
  nodes: FlowNode[],
  collapsedChapters: Record<string, boolean>,
): FlowEdge[] {
  const nodeChapterMap = new Map<string, string>();
  for (const node of nodes) {
    const chapter = node.chapter || "Uncategorized";
    nodeChapterMap.set(node.id, chapter);
  }

  const redirected: FlowEdge[] = [];
  const seenPairKeys = new Set<string>();

  for (const edge of edges) {
    const sourceChapter = nodeChapterMap.get(edge.source) || "Uncategorized";
    const targetChapter = nodeChapterMap.get(edge.target) || "Uncategorized";

    const isSourceCollapsed = Boolean(collapsedChapters[sourceChapter]);
    const isTargetCollapsed = Boolean(collapsedChapters[targetChapter]);

    // 1. Both endpoints inside the same collapsed chapter: suppress internal edge
    if (
      isSourceCollapsed && isTargetCollapsed && sourceChapter === targetChapter
    ) {
      continue;
    }

    // 2. Redirect endpoints if collapsed
    const effectiveSource = isSourceCollapsed
      ? getChapterId(sourceChapter)
      : edge.source;
    const effectiveTarget = isTargetCollapsed
      ? getChapterId(targetChapter)
      : edge.target;

    // Self-loop on the collapsed chapter container: suppress
    if (effectiveSource === effectiveTarget) {
      continue;
    }

    const isRedirected = isSourceCollapsed || isTargetCollapsed;

    if (isRedirected) {
      const pairKey = `${effectiveSource}__${effectiveTarget}__${
        edge.kind || "seq"
      }`;
      if (seenPairKeys.has(pairKey)) {
        continue;
      }
      seenPairKeys.add(pairKey);
    }

    redirected.push({
      ...edge,
      id: isRedirected
        ? `${edge.id}__redirected_${effectiveSource}_${effectiveTarget}`
        : edge.id,
      source: effectiveSource,
      target: effectiveTarget,
    });
  }

  return redirected;
}
