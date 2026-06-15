import type { EdgeKindFilter, FlowEdge, FlowNode } from "../index.ts";

/**
 * The complete list of recognised edge kind strings.
 * Used for runtime validation of edge kind values before they enter the render layer.
 */
export const EDGE_KIND_FILTERS: ReadonlyArray<EdgeKindFilter> = [
  "sequence",
  "jump",
  "call",
  "call_return",
];

/**
 * Coerces an arbitrary edge kind string to a valid EdgeKindFilter value.
 * Falls back to 'sequence' when the input is absent or unrecognised.
 */
export function normalizeEdgeKind(kind: string | undefined): EdgeKindFilter {
  if (kind && EDGE_KIND_FILTERS.includes(kind as EdgeKindFilter)) {
    return kind as EdgeKindFilter;
  }
  return "sequence";
}

/**
 * Pre-render graph integrity pass that prepares raw parser output for safe rendering.
 * Performs three operations:
 * 1. **Node deduplication** — retains only the first occurrence of each node ID.
 * 2. **Placeholder injection** — for any edge whose source or target ID is not present
 *    in the node set, injects a synthetic placeholder node tagged with chapter
 *    `__unresolved__`. This keeps edges intact for display without crashing the renderer.
 * 3. **Semantic edge deduplication** — drops edges that are identical in kind, source,
 *    target, label, and timeout key, assigning a stable derived ID when the edge ID
 *    is empty.
 *
 * @param rawNodes Array of FlowNodes from the parser output.
 * @param rawEdges Array of FlowEdges from the parser output.
 * @returns A cleaned `{ nodes, edges }` pair ready for layout.
 */
export function resolveGraphIntegrity(
  rawNodes: FlowNode[],
  rawEdges: FlowEdge[],
): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const nodeMap = new Map<string, FlowNode>();
  const nodes: FlowNode[] = [];
  for (const node of rawNodes) {
    if (nodeMap.has(node.id)) continue;
    nodeMap.set(node.id, node);
    nodes.push(node);
  }

  const edges: FlowEdge[] = [];
  const seenEdgeKeys = new Set<string>();
  for (const edge of rawEdges) {
    if (!edge.source || !edge.target) continue;
    if (!nodeMap.has(edge.source)) {
      const sourcePlaceholder: FlowNode = {
        id: edge.source,
        type: "LABEL",
        label: `(unresolved) ${edge.source}`,
        dialogueCount: 0,
        chapter: "__unresolved__",
      };
      nodeMap.set(edge.source, sourcePlaceholder);
      nodes.push(sourcePlaceholder);
    }
    if (!nodeMap.has(edge.target)) {
      const targetPlaceholder: FlowNode = {
        id: edge.target,
        type: "LABEL",
        label: `(unresolved) ${edge.target}`,
        dialogueCount: 0,
        chapter: "__unresolved__",
      };
      nodeMap.set(edge.target, targetPlaceholder);
      nodes.push(targetPlaceholder);
    }
    const normalizedKind = normalizeEdgeKind(edge.kind);
    const timeoutKey = edge.timeout?.isTimeout
      ? `timeout:${
        edge.timeout.durationSeconds === undefined
          ? "unknown"
          : edge.timeout.durationSeconds
      }`
      : "normal";
    const semanticKey = `${normalizedKind}|${edge.source}|${edge.target}|${
      edge.label ?? ""
    }|${timeoutKey}`;
    if (seenEdgeKeys.has(semanticKey)) continue;
    seenEdgeKeys.add(semanticKey);
    edges.push({
      ...edge,
      id: edge.id || `${normalizedKind}_${edge.source}__${edge.target}`,
      kind: normalizedKind,
    });
  }

  return { nodes, edges };
}
