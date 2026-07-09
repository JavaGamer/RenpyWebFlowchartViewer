import type { ParseGraphState } from "./pipelineTypes.ts";
import { addParseDiagnostic } from "./diagnostics.ts";

/**
 * Runs control-flow analysis on the finalized graph state.
 * Detects:
 * 1. Unreachable labels (orphans).
 * 2. Dialogue-less tight infinite cycles.
 * 3. Call-return mismatches.
 */
export function runControlFlowAnalysis(state: ParseGraphState): void {
  analyzeReachability(state);
  analyzeTightCycles(state);
  analyzeCallReturnMismatches(state);
}

function analyzeReachability(state: ParseGraphState): void {
  const visited = new Set<string>();
  const queue: string[] = [];

  if (state.nodeMap.has("start")) {
    queue.push("start");
    visited.add("start");
  } else {
    // If no "start" label exists, start from all nodes with 0 incoming edges
    for (const node of state.nodes) {
      if (node.type === "LABEL" && !node.isShadowed) {
        const incoming = state.incomingByLabel.get(node.id);
        if (!incoming || incoming.size === 0) {
          queue.push(node.id);
          visited.add(node.id);
        }
      }
    }
  }

  while (queue.length > 0) {
    const currId = queue.shift()!;
    const outgoingEdges = state.edges.filter((e) => e.source === currId);
    for (const edge of outgoingEdges) {
      if (!visited.has(edge.target)) {
        if (state.nodeMap.has(edge.target)) {
          visited.add(edge.target);
          queue.push(edge.target);
        }
      }
    }
  }

  for (const node of state.nodes) {
    if (node.type === "LABEL" && !node.isShadowed && !visited.has(node.id)) {
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
          },
          context: {
            category: "unreachable_label",
            detail: node.label,
          },
          message: `Label "${node.label}" is unreachable from entry points.`,
          recoveryAction: "Ensure there is a jump, call, or sequence path to this label.",
        },
        `unreachable_label|${node.id}`,
      );
    }
  }
}

function analyzeTightCycles(state: ParseGraphState): void {
  const path = new Set<string>();
  const tempVisited = new Set<string>();

  function dfsCycle(nodeId: string, currentPath: string[]) {
    if (path.has(nodeId)) {
      const cycleStartIndex = currentPath.indexOf(nodeId);
      const cycle = currentPath.slice(cycleStartIndex);
      let hasInteraction = false;
      for (const id of cycle) {
        const node = state.nodeMap.get(id);
        if (node) {
          if (
            node.type === "MENU" ||
            node.dialogueCount > 0 ||
            (node.pauseDuration && node.pauseDuration > 0)
          ) {
            hasInteraction = true;
            break;
          }
        }
      }
      if (!hasInteraction) {
        const cycleLabels = cycle
          .map((id) => state.nodeMap.get(id)?.label ?? id)
          .join(" -> ");
        const cycleKey = [...cycle].sort().join("|");
        addParseDiagnostic(
          state,
          {
            code: "normalization",
            severity: "warning",
            location: {
              sourceId: nodeId,
            },
            context: {
              category: "infinite_loop",
              detail: cycleLabels,
            },
            message: `Dialogue-less infinite loop detected: ${cycleLabels} -> ${
              state.nodeMap.get(nodeId)?.label ?? nodeId
            }`,
            recoveryAction: "Add a dialogue line, a menu choice, or a pause statement to break the tight loop.",
          },
          `infinite_loop|${cycleKey}`,
        );
      }
      return;
    }
    if (tempVisited.has(nodeId)) return;
    tempVisited.add(nodeId);
    path.add(nodeId);
    currentPath.push(nodeId);

    const outgoingEdges = state.edges.filter(
      (e) => e.source === nodeId && (e.kind === "sequence" || e.kind === "jump"),
    );
    for (const edge of outgoingEdges) {
      dfsCycle(edge.target, currentPath);
    }

    currentPath.pop();
    path.delete(nodeId);
  }

  for (const node of state.nodes) {
    dfsCycle(node.id, []);
    tempVisited.clear();
  }
}

function analyzeCallReturnMismatches(state: ParseGraphState): void {
  function canReachReturn(startId: string): boolean {
    const visited = new Set<string>();
    const queue = [startId];
    visited.add(startId);

    while (queue.length > 0) {
      const currId = queue.shift()!;
      if (state.hasReturnInLabel.has(currId)) {
        return true;
      }
      const outgoingEdges = state.edges.filter(
        (e) =>
          e.source === currId && (e.kind === "sequence" || e.kind === "jump"),
      );
      for (const edge of outgoingEdges) {
        if (!visited.has(edge.target)) {
          visited.add(edge.target);
          queue.push(edge.target);
        }
      }
    }
    return false;
  }

  for (const calledId of state.calledLabels) {
    if (!canReachReturn(calledId)) {
      const node = state.nodeMap.get(calledId);
      if (node) {
        addParseDiagnostic(
          state,
          {
            code: "normalization",
            severity: "warning",
            location: {
              chapter: node.chapter,
              construct: "label",
              sourceId: calledId,
            },
            context: {
              category: "missing_return",
              detail: node.label,
            },
            message: `Called label "${node.label}" has no path to a return statement.`,
            recoveryAction: "Add a return statement at the end of the called label block.",
          },
          `missing_return|${calledId}`,
        );
      }
    }
  }

  for (const labelId of state.hasReturnInLabel) {
    if (!state.calledLabels.has(labelId) && labelId !== "start") {
      const node = state.nodeMap.get(labelId);
      if (node && node.role === "story") {
        addParseDiagnostic(
          state,
          {
            code: "normalization",
            severity: "warning",
            location: {
              chapter: node.chapter,
              construct: "label",
              sourceId: labelId,
            },
            context: {
              category: "uncalled_return",
              detail: node.label,
            },
            message: `Label "${node.label}" contains a return statement but is never invoked via call.`,
            recoveryAction: "Verify if this label should be jumped to or called.",
          },
          `uncalled_return|${labelId}`,
        );
      }
    }
  }
}
