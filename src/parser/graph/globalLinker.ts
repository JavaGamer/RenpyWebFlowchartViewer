/**
 * src/parser/graph/globalLinker.ts
 *
 * Multi-File Global Linker:
 * Combines per-file graph fragments, resolves cross-file call returns,
 * and performs reachability analysis.
 */

import type { FlowEdge, FlowNode } from "../../domain/graph.ts";
import type { GraphBuildResult } from "./graphBuilder.ts";

export interface LinkedProjectGraph {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

export function linkProjectGraphs(
  fragments: GraphBuildResult[],
): LinkedProjectGraph {
  const nodeMap = new Map<string, FlowNode>();
  const allEdges: FlowEdge[] = [];
  const edgeIds = new Set<string>();

  // 1. Merge all nodes
  for (const frag of fragments) {
    for (const node of frag.nodes) {
      if (!nodeMap.has(node.id)) {
        nodeMap.set(node.id, { ...node });
      }
    }
  }

  // 2. Merge all edges
  for (const frag of fragments) {
    for (const edge of frag.edges) {
      if (!edgeIds.has(edge.id)) {
        edgeIds.add(edge.id);
        allEdges.push({ ...edge });
      }
    }
  }

  // 3. Resolve subroutine call returns
  // For each 'call' edge, link an explicit 'call_return' edge from target back to returnTargetId
  const callEdges = allEdges.filter((e) => e.kind === "call" && e.callContext);
  for (const callEdge of callEdges) {
    const ctx = callEdge.callContext!;
    const retEdgeId = `ret_${ctx.callContextId}`;
    if (
      !edgeIds.has(retEdgeId) && nodeMap.has(callEdge.target) &&
      nodeMap.has(ctx.returnTargetId)
    ) {
      edgeIds.add(retEdgeId);
      allEdges.push({
        id: retEdgeId,
        source: callEdge.target,
        target: ctx.returnTargetId,
        kind: "call_return",
        callContext: ctx,
        label: "return",
      });
    }
  }

  // 4. Reachability analysis: mark unreachable nodes as isOrphan
  const allNodes = Array.from(nodeMap.values());
  const incomingMap = new Map<string, number>();
  for (const n of allNodes) {
    incomingMap.set(n.id, 0);
  }
  for (const e of allEdges) {
    if (incomingMap.has(e.target)) {
      incomingMap.set(e.target, (incomingMap.get(e.target) || 0) + 1);
    }
  }

  // Entry point roots: "start", "splashscreen", "main_menu", "after_load"
  const KNOWN_ENTRY_POINTS = new Set([
    "start",
    "splashscreen",
    "main_menu",
    "after_load",
  ]);
  const roots: string[] = [];

  for (const n of allNodes) {
    if (KNOWN_ENTRY_POINTS.has(n.id)) {
      roots.push(n.id);
    }
  }

  // If no standard entry point exists in the project, fallback to nodes with 0 incoming edges
  if (roots.length === 0) {
    for (const n of allNodes) {
      if (
        incomingMap.get(n.id) === 0 &&
        !n.id.includes("__cont_")
      ) {
        roots.push(n.id);
      }
    }
  }

  const visited = new Set<string>();
  const queue = [...roots];
  for (const r of roots) {
    visited.add(r);
  }

  const outgoingMap = new Map<string, string[]>();
  for (const e of allEdges) {
    if (!outgoingMap.has(e.source)) {
      outgoingMap.set(e.source, []);
    }
    outgoingMap.get(e.source)!.push(e.target);
  }

  while (queue.length > 0) {
    const curr = queue.shift()!;
    const neighbors = outgoingMap.get(curr) || [];
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
  }

  for (const n of allNodes) {
    if (!visited.has(n.id)) {
      n.isOrphan = true;
    }
  }

  return {
    nodes: allNodes,
    edges: allEdges,
  };
}
