import type { FlowEdge, FlowNode } from "../graph.ts";

export interface PathResult {
  reachable: boolean;
  pathNodes: string[]; // ordered sequence of node IDs from start to target
  pathEdges: string[]; // ordered sequence of edge IDs from start to target
  visitedNodesCount: number;
}

/**
 * Performs BFS to find the shortest path (by number of edges) from startNodeId to targetNodeId.
 */
export function findPath(
  _nodes: FlowNode[],
  edges: FlowEdge[],
  startNodeId: string,
  targetNodeId: string,
): PathResult {
  if (!startNodeId || !targetNodeId) {
    return {
      reachable: false,
      pathNodes: [],
      pathEdges: [],
      visitedNodesCount: 0,
    };
  }

  // Build adjacency list for efficient graph traversal.
  // We need to keep track of the edge ID that connects u to v.
  const adjacency = new Map<
    string,
    Array<{ target: string; edgeId: string }>
  >();

  for (const edge of edges) {
    let neighbors = adjacency.get(edge.source);
    if (!neighbors) {
      neighbors = [];
      adjacency.set(edge.source, neighbors);
    }
    neighbors.push({ target: edge.target, edgeId: edge.id });
  }

  const visited = new Set<string>();
  const queue: string[] = [startNodeId];
  visited.add(startNodeId);

  // Map to reconstruct the path: node -> { prevNode, edgeIdToNode }
  const cameFrom = new Map<string, { prev: string; edgeId: string }>();

  let found = false;

  while (queue.length > 0) {
    const current = queue.shift()!;

    if (current === targetNodeId) {
      found = true;
      break;
    }

    const neighbors = adjacency.get(current) || [];
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor.target)) {
        visited.add(neighbor.target);
        cameFrom.set(neighbor.target, {
          prev: current,
          edgeId: neighbor.edgeId,
        });
        queue.push(neighbor.target);
      }
    }
  }

  if (!found) {
    return {
      reachable: false,
      pathNodes: [],
      pathEdges: [],
      visitedNodesCount: visited.size,
    };
  }

  // Reconstruct path
  const pathNodes: string[] = [];
  const pathEdges: string[] = [];

  let curr = targetNodeId;
  while (curr !== startNodeId) {
    pathNodes.push(curr);
    const step = cameFrom.get(curr)!;
    pathEdges.push(step.edgeId);
    curr = step.prev;
  }

  pathNodes.push(startNodeId);

  pathNodes.reverse();
  pathEdges.reverse();

  return {
    reachable: true,
    pathNodes,
    pathEdges,
    visitedNodesCount: visited.size,
  };
}
