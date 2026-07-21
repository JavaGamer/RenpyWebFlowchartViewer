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
  analyzeNarrativeDeadEnds(state);
  analyzeUninitializedVariables(state);
  analyzeCallReturnContext(state);
}

function analyzeReachability(state: ParseGraphState): void {
  const visited = new Set<string>();
  const queue: string[] = [];

  const RENPY_ENTRY_LABELS = new Set([
    "start",
    "splashscreen",
    "after_load",
    "before_main_menu",
    "main_menu",
  ]);

  const entryNodes = state.nodes.filter(
    (n) => n.type === "LABEL" && RENPY_ENTRY_LABELS.has(n.label),
  );

  if (entryNodes.length > 0) {
    for (const node of entryNodes) {
      queue.push(node.id);
      visited.add(node.id);
    }
  } else {
    // If no entry label exists, start from all nodes with 0 incoming edges
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
          recoveryAction:
            "Ensure there is a jump, call, or sequence path to this label.",
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
              chapter: state.nodeMap.get(nodeId)?.chapter,
              construct: "label",
              sourceId: nodeId,
            },
            context: {
              category: "infinite_loop",
              detail: cycleLabels,
            },
            message: `Dialogue-less infinite loop detected: ${cycleLabels} -> ${
              state.nodeMap.get(nodeId)?.label ?? nodeId
            }`,
            recoveryAction:
              "Add a dialogue line, a menu choice, or a pause statement to break the tight loop.",
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
      (e) =>
        e.source === nodeId && (e.kind === "sequence" || e.kind === "jump"),
    );
    for (const edge of outgoingEdges) {
      dfsCycle(edge.target, currentPath);
    }

    currentPath.pop();
    path.delete(nodeId);
  }

  for (const node of state.nodes) {
    dfsCycle(node.id, []);
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
            message:
              `Called label "${node.label}" has no path to a return statement.`,
            recoveryAction:
              "Add a return statement at the end of the called label block.",
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
            message:
              `Label "${node.label}" contains a return statement but is never invoked via call.`,
            recoveryAction:
              "Verify if this label should be jumped to or called.",
          },
          `uncalled_return|${labelId}`,
        );
      }
    }
  }
}

function analyzeNarrativeDeadEnds(state: ParseGraphState): void {
  for (const node of state.nodes) {
    if (node.type === "LABEL" && !node.isShadowed) {
      if (node.label === "main_menu" || node.label === "splashscreen") continue;
      const outgoing = state.edges.filter((e) => e.source === node.id);
      const hasReturn = state.hasReturnInLabel.has(node.id);
      if (outgoing.length === 0 && !hasReturn) {
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
              category: "narrative_deadend",
              detail: node.label,
            },
            message: `Label "${node.label}" is a narrative dead-end (has no outgoing transitions or return).`,
            recoveryAction:
              "Add a jump, call, menu choice, or return statement to prevent narrative soft-lock.",
          },
          `narrative_deadend|${node.id}`,
        );
      }
    }
  }
}

function analyzeUninitializedVariables(state: ParseGraphState): void {
  const reportedVars = new Set<string>();
  for (const item of state.referencedVariables) {
    const varName = item.varName.trim();
    if (!varName) continue;
    const rootVar = varName.split(".")[0] ?? varName;
    if (
      !state.declaredGlobalVariables.has(varName) &&
      !state.declaredGlobalVariables.has(rootVar)
    ) {
      const key = `${varName}|${item.location?.sourceId ?? ""}`;
      if (reportedVars.has(key)) continue;
      reportedVars.add(key);
      addParseDiagnostic(
        state,
        {
          code: "normalization",
          severity: "warning",
          location: item.location,
          context: {
            category: "uninitialized_variable",
            detail: varName,
          },
          message: `Variable "${varName}" is referenced in conditional logic but never declared in default/define.`,
          recoveryAction:
            `Add 'default ${varName} = False' or 'define ${varName} = ...' to initialize this variable.`,
        },
        `uninitialized_variable|${key}`,
      );
    }
  }
}

function analyzeCallReturnContext(state: ParseGraphState): void {
  const callersByTarget = new Map<string, Set<string>>();
  for (const edge of state.edges) {
    if (edge.kind === "call") {
      const existing = callersByTarget.get(edge.target);
      if (existing) {
        existing.add(edge.source);
      } else {
        callersByTarget.set(edge.target, new Set([edge.source]));
      }
    }
  }

  for (const [calledId, callers] of callersByTarget.entries()) {
    if (callers.size > 1) {
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
              category: "call_return_context",
              detail: `${node.label} (${callers.size} callers)`,
            },
            message: `Label "${node.label}" is called from ${callers.size} separate locations; return paths are multi-contextual.`,
            recoveryAction:
              "Inspect incoming call edges to verify flow after return.",
          },
          `call_return_context|${calledId}`,
        );
      }
    }
  }
}
