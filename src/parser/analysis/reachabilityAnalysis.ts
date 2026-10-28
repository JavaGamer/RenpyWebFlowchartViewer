import type { ParseGraphState } from "../pipelineTypes.ts";
import { addParseDiagnostic } from "../diagnostics.ts";
import type { FlowEdge } from "../../domain/index.ts";

export function analyzeReachability(
  state: ParseGraphState,
  outgoingMap: Map<string, FlowEdge[]>,
): void {
  const visited = new Set<string>();
  const queue: string[] = [];

  const canonicalStart = state.canonicalLabelIdByName.get("start") ?? "start";
  let startId = state.nodeMap.has("start")
    ? "start"
    : state.nodeMap.has(canonicalStart)
    ? canonicalStart
    : null;

  if (!startId) {
    const startRegex = /(?:^|[._])start\d*(?:$|[._]|__|\s*:)/i;
    const startCandidates = state.nodes.filter(
      (n) =>
        n.role === "story" &&
        (startRegex.test(n.id) || (n.label ? startRegex.test(n.label) : false)),
    );
    if (startCandidates.length === 1) {
      startId = startCandidates[0]!.id;
    } else if (startCandidates.length > 1) {
      const roots = startCandidates.filter((n) => {
        const incoming = state.incomingByLabel.get(n.id);
        return !incoming ||
          !Array.from(incoming).some((kind) => kind !== "call_return");
      });
      if (roots.length === 1) {
        startId = roots[0]!.id;
      }
    }
  }

  if (startId) {
    queue.push(startId);
    visited.add(startId);
  } else {
    // If no "start" label exists, start from all story nodes with 0 incoming edges
    for (const node of state.nodes) {
      if (
        node.role === "story" &&
        (!state.incomingByLabel.has(node.id) ||
          state.incomingByLabel.get(node.id)!.size === 0)
      ) {
        queue.push(node.id);
        visited.add(node.id);
      }
    }
  }

  while (queue.length > 0) {
    const currId = queue.shift()!;
    const outgoing = outgoingMap.get(currId) ?? [];
    for (const edge of outgoing) {
      if (!visited.has(edge.target)) {
        visited.add(edge.target);
        queue.push(edge.target);
      }
    }
  }

  for (const node of state.nodes) {
    if (
      node.role === "story" &&
      !visited.has(node.id)
    ) {
      node.isOrphan = true;
      addParseDiagnostic(
        state,
        {
          code: "normalization",
          severity: "warning",
          location: {
            chapter: node.chapter,
            construct: "label",
            sourceId: node.id,
            sourceLocation: node.sourceLocation,
          },
          context: {
            category: "unreachable_label",
            detail: node.label,
          },
          message:
            `Label "${node.label}" is unreachable from start or any entry node.`,
          recoveryAction:
            "Add a jump or call to this label or verify entry point logic.",
        },
        `unreachable_label|${node.id}`,
      );
    }
  }
}
