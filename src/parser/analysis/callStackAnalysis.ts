import type { ParseGraphState } from "../pipelineTypes.ts";
import { addParseDiagnostic } from "../diagnostics.ts";
import type { FlowEdge } from "../../domain/index.ts";

export function analyzeCallReturnMismatches(
  state: ParseGraphState,
  outgoingMap: Map<string, FlowEdge[]>,
): void {
  function canReachReturn(startId: string): boolean {
    const visited = new Set<string>();
    const queue = [startId];
    visited.add(startId);

    while (queue.length > 0) {
      const currId = queue.shift()!;
      if (state.hasReturnInLabel.has(currId)) {
        return true;
      }
      const outgoingEdges = (outgoingMap.get(currId) ?? []).filter(
        (e) =>
          e.kind === "sequence" ||
          e.kind === "jump" ||
          e.kind === "call_return",
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

  function getBaseLabelId(id: string): string {
    return id.split("__scene_")[0]!;
  }

  const calledBaseLabels = new Set<string>();
  for (const c of state.calledLabels) {
    calledBaseLabels.add(getBaseLabelId(c));
  }

  const allCalledConstituentNodes = new Set<string>();
  for (const node of state.nodes) {
    if (calledBaseLabels.has(getBaseLabelId(node.id))) {
      allCalledConstituentNodes.add(node.id);
    }
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
              sourceLocation: node.sourceLocation,
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

  // Check for dangling stack across all constituent nodes of called subroutines
  for (const nodeId of allCalledConstituentNodes) {
    const outgoing = outgoingMap.get(nodeId) ?? [];
    for (const edge of outgoing) {
      if (
        edge.kind === "sequence" &&
        edge.label === "next" &&
        state.allLabelIds.has(edge.target) &&
        getBaseLabelId(edge.target) !== getBaseLabelId(nodeId)
      ) {
        const node = state.nodeMap.get(nodeId);
        const targetNode = state.nodeMap.get(edge.target);
        const displayLabel = node?.label ?? nodeId;
        addParseDiagnostic(
          state,
          {
            code: "normalization",
            severity: "warning",
            location: {
              chapter: node?.chapter,
              construct: "label",
              sourceId: nodeId,
              targetId: edge.target,
              edgeId: edge.id,
              sourceLocation: edge.sourceLocation ?? node?.sourceLocation,
            },
            context: {
              category: "dangling_stack",
              detail: displayLabel,
            },
            message: `Called label "${displayLabel}" falls through into "${
              targetNode?.label ?? edge.target
            }" without returning, leaving a dangling call stack frame.`,
            recoveryAction:
              "Add an explicit return statement before the label boundary or jump explicitly.",
          },
          `dangling_stack|${nodeId}|${edge.target}`,
        );
      }
    }
  }

  for (const labelId of state.hasReturnInLabel) {
    const baseId = getBaseLabelId(labelId);
    if (!calledBaseLabels.has(baseId) && baseId !== "start") {
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
              sourceLocation: node.sourceLocation,
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

export function analyzeCallStackDepth(
  state: ParseGraphState,
  outgoingMap: Map<string, FlowEdge[]>,
  maxDepthLimit?: number,
): void {
  const maxDepth = state.maxCallStackDepth ?? maxDepthLimit ?? 50;

  const entryNodes = new Set<string>();
  const canonicalStart = state.canonicalLabelIdByName.get("start") ?? "start";
  if (state.nodeMap.has("start")) {
    entryNodes.add("start");
  } else if (state.nodeMap.has(canonicalStart)) {
    entryNodes.add(canonicalStart);
  }

  for (const node of state.nodes) {
    const incoming = state.incomingByLabel.get(node.id);
    const hasIncomingForwardFlow = incoming &&
      Array.from(incoming).some((kind) => kind !== "call_return");
    if (node.role === "story" && !hasIncomingForwardFlow) {
      entryNodes.add(node.id);
    }
  }

  for (const calledId of state.calledLabels) {
    entryNodes.add(calledId);
  }

  const maxDepthSeenAtNode = new Map<string, number>();

  for (const startId of entryNodes) {
    const stack: Array<{ nodeId: string; callStack: string[] }> = [
      { nodeId: startId, callStack: [] },
    ];

    while (stack.length > 0) {
      const { nodeId, callStack } = stack.pop()!;
      const currentDepth = callStack.length;

      const prevMax = maxDepthSeenAtNode.get(nodeId);
      if (prevMax !== undefined && prevMax >= currentDepth) {
        continue;
      }
      maxDepthSeenAtNode.set(nodeId, currentDepth);

      const outgoing = outgoingMap.get(nodeId) ?? [];
      for (const edge of outgoing) {
        if (edge.kind === "call") {
          const nextStack = [...callStack, edge.target];
          if (nextStack.length > maxDepth) {
            const targetNode = state.nodeMap.get(edge.target);
            const chainDisplay = nextStack
              .map((id) => state.nodeMap.get(id)?.label ?? id)
              .join(" -> ");
            addParseDiagnostic(
              state,
              {
                code: "normalization",
                severity: "warning",
                location: {
                  chapter: targetNode?.chapter,
                  construct: "call",
                  sourceId: edge.source,
                  targetId: edge.target,
                  edgeId: edge.id,
                  sourceLocation: edge.sourceLocation ??
                    targetNode?.sourceLocation,
                },
                context: {
                  category: "excessive_call_depth",
                  detail: `${nextStack.length} frames`,
                },
                message:
                  `Call stack depth (${nextStack.length}) exceeds safe limit (${maxDepth}): ${chainDisplay}`,
                recoveryAction:
                  "Refactor deep subroutine nesting into jumps or ensure returns pop call frames appropriately.",
              },
              `excessive_call_depth|${nextStack.join("|")}`,
            );
            continue;
          }
          stack.push({ nodeId: edge.target, callStack: nextStack });
        } else if (edge.kind === "call_return") {
          const nextStack = callStack.length > 0 ? callStack.slice(0, -1) : [];
          stack.push({ nodeId: edge.target, callStack: nextStack });
        } else {
          stack.push({ nodeId: edge.target, callStack });
        }
      }
    }
  }
}
