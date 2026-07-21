import type { FlowClusterNode, FlowEdge, FlowNode } from "../graph.ts";

export interface ChapterClusteringOptions {
  collapsedChapters: Set<string>;
}

export interface ChapterClusteringResult {
  nodes: FlowNode[];
  edges: FlowEdge[];
  clusterNodes: FlowClusterNode[];
}

export function applyChapterClustering(
  nodes: FlowNode[],
  edges: FlowEdge[],
  options: ChapterClusteringOptions,
): ChapterClusteringResult {
  const { collapsedChapters } = options;
  if (!collapsedChapters || collapsedChapters.size === 0) {
    return { nodes, edges, clusterNodes: [] };
  }

  const collapsedNodeIdToClusterId = new Map<string, string>();
  const chapterToNodes = new Map<string, FlowNode[]>();

  for (const node of nodes) {
    const chapter = node.chapter ?? "default";
    const list = chapterToNodes.get(chapter) ?? [];
    list.push(node);
    chapterToNodes.set(chapter, list);

    if (collapsedChapters.has(chapter)) {
      const clusterId = `cluster:${chapter}`;
      collapsedNodeIdToClusterId.set(node.id, clusterId);
    }
  }

  const clusterNodes: FlowClusterNode[] = [];
  const activeNodes: FlowNode[] = [];

  for (const [chapter, chapterNodes] of chapterToNodes.entries()) {
    if (collapsedChapters.has(chapter)) {
      const clusterId = `cluster:${chapter}`;
      let totalDialogue = 0;
      const childrenIds: string[] = [];

      for (const cn of chapterNodes) {
        totalDialogue += cn.dialogueCount ?? 0;
        childrenIds.push(cn.id);
      }

      clusterNodes.push({
        id: clusterId,
        chapter,
        label: `Chapter: ${chapter}`,
        childrenNodeIds: childrenIds,
        dialogueCount: totalDialogue,
        nodeCount: chapterNodes.length,
        isCollapsed: true,
      });
    } else {
      activeNodes.push(...chapterNodes);
    }
  }

  const activeEdges: FlowEdge[] = [];
  const seenEdgeKeys = new Set<string>();

  for (const edge of edges) {
    const sourceCluster = collapsedNodeIdToClusterId.get(edge.source);
    const targetCluster = collapsedNodeIdToClusterId.get(edge.target);

    const newSource = sourceCluster ?? edge.source;
    const newTarget = targetCluster ?? edge.target;

    if (newSource === newTarget) {
      continue;
    }

    const dedupeKey = `${newSource}->${newTarget}:${edge.kind ?? "sequence"}:${
      edge.label ?? ""
    }`;
    if (seenEdgeKeys.has(dedupeKey)) {
      continue;
    }
    seenEdgeKeys.add(dedupeKey);

    activeEdges.push({
      ...edge,
      source: newSource,
      target: newTarget,
    });
  }

  return {
    nodes: activeNodes,
    edges: activeEdges,
    clusterNodes,
  };
}
