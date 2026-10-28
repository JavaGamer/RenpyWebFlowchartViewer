import type { ParseGraphState } from "../pipelineTypes.ts";
import { addParseDiagnostic } from "../diagnostics.ts";
import type { FlowEdge } from "../../domain/index.ts";

/**
 * Iterative stack-based 3-color DFS to detect dialogue-less tight infinite loops safely
 * without stack overflow or N^2 array scanning.
 */
export function analyzeTightCycles(
  state: ParseGraphState,
  outgoingMap: Map<string, FlowEdge[]>,
): void {
  const color = new Map<string, number>(); // 0: unvisited, 1: visiting, 2: visited
  const stack: Array<{ nodeId: string; edgeIndex: number }> = [];
  const pathNodes: string[] = [];

  for (const node of state.nodes) {
    if ((color.get(node.id) ?? 0) !== 0) continue;

    color.set(node.id, 1);
    pathNodes.push(node.id);
    stack.push({ nodeId: node.id, edgeIndex: 0 });

    while (stack.length > 0) {
      const top = stack[stack.length - 1]!;
      const outgoing = (outgoingMap.get(top.nodeId) ?? []).filter(
        (e) => e.kind === "sequence" || e.kind === "jump",
      );

      if (top.edgeIndex < outgoing.length) {
        const edge = outgoing[top.edgeIndex]!;
        top.edgeIndex += 1;
        const targetId = edge.target;
        const targetColor = color.get(targetId) ?? 0;

        if (targetColor === 1) {
          // Cycle detected!
          const cycleStartIndex = pathNodes.indexOf(targetId);
          if (cycleStartIndex !== -1) {
            const cycle = pathNodes.slice(cycleStartIndex);
            let hasInteraction = false;
            for (const id of cycle) {
              const n = state.nodeMap.get(id);
              if (
                n &&
                (n.type === "MENU" ||
                  n.dialogueCount > 0 ||
                  (n.pauseDuration && n.pauseDuration > 0) ||
                  n.role === "while_loop" ||
                  n.role === "for_loop")
              ) {
                hasInteraction = true;
                break;
              }
            }
            if (!hasInteraction) {
              const cycleLabels = cycle
                .map((id) => state.nodeMap.get(id)?.label ?? id)
                .join(" -> ");
              const cycleKey = [...cycle].sort().join("|");
              const targetNode = state.nodeMap.get(targetId);
              addParseDiagnostic(
                state,
                {
                  code: "normalization",
                  severity: "warning",
                  location: {
                    sourceId: targetId,
                    sourceLocation: targetNode?.sourceLocation,
                  },
                  context: {
                    category: "infinite_loop",
                    detail: cycleLabels,
                  },
                  message:
                    `Dialogue-less infinite loop detected: ${cycleLabels} -> ${
                      state.nodeMap.get(targetId)?.label ?? targetId
                    }`,
                  recoveryAction:
                    "Add a dialogue line, a menu choice, or a pause statement to break the tight loop.",
                },
                `infinite_loop|${cycleKey}`,
              );
            }
          }
        } else if (targetColor === 0) {
          color.set(targetId, 1);
          pathNodes.push(targetId);
          stack.push({ nodeId: targetId, edgeIndex: 0 });
        }
      } else {
        color.set(top.nodeId, 2);
        pathNodes.pop();
        stack.pop();
      }
    }
  }
}

/**
 * Detects recursive call cycles that lack base-case returns or interactive barriers.
 */
export function analyzeCallCycles(
  state: ParseGraphState,
  outgoingMap: Map<string, FlowEdge[]>,
): void {
  const color = new Map<string, number>(); // 0: unvisited, 1: visiting, 2: visited
  const stack: Array<{ nodeId: string; edgeIndex: number }> = [];
  const pathNodes: string[] = [];

  for (const node of state.nodes) {
    if ((color.get(node.id) ?? 0) !== 0) continue;

    color.set(node.id, 1);
    pathNodes.push(node.id);
    stack.push({ nodeId: node.id, edgeIndex: 0 });

    while (stack.length > 0) {
      const top = stack[stack.length - 1]!;
      const outgoing = (outgoingMap.get(top.nodeId) ?? []).filter(
        (e) => e.kind === "call",
      );

      if (top.edgeIndex < outgoing.length) {
        const edge = outgoing[top.edgeIndex]!;
        top.edgeIndex += 1;
        const targetId = edge.target;
        const targetColor = color.get(targetId) ?? 0;

        if (targetColor === 1) {
          // Cycle detected!
          const cycleStartIndex = pathNodes.indexOf(targetId);
          if (cycleStartIndex !== -1) {
            const cycle = pathNodes.slice(cycleStartIndex);
            let hasExitOrReturn = false;
            for (const id of cycle) {
              if (
                state.hasReliableReturnInLabel.has(id) ||
                state.hasReturnInLabel.has(id)
              ) {
                hasExitOrReturn = true;
                break;
              }
              const edgesFromNode = outgoingMap.get(id) ?? [];
              const hasNonCallFlow = edgesFromNode.some(
                (e) =>
                  (e.kind === "jump" || e.kind === "sequence") &&
                  e.target !== id,
              );
              if (hasNonCallFlow) {
                hasExitOrReturn = true;
                break;
              }
            }

            if (!hasExitOrReturn) {
              const cycleLabels = cycle
                .map((id) => state.nodeMap.get(id)?.label ?? id)
                .join(" -> ");
              const cycleKey = [...cycle].sort().join("|");
              const targetNode = state.nodeMap.get(targetId);
              addParseDiagnostic(
                state,
                {
                  code: "normalization",
                  severity: "warning",
                  location: {
                    sourceId: targetId,
                    sourceLocation: targetNode?.sourceLocation,
                  },
                  context: {
                    category: "call_cycle_deadlock",
                    detail: cycleLabels,
                  },
                  message:
                    `Recursive call stack deadlock detected: ${cycleLabels} -> ${
                      targetNode?.label ?? targetId
                    } with no base-case return path.`,
                  recoveryAction:
                    "Ensure recursive subroutine calls have a conditional base case that reaches a return statement.",
                },
                `call_cycle_deadlock|${cycleKey}`,
              );
            }
          }
        } else if (targetColor === 0) {
          color.set(targetId, 1);
          pathNodes.push(targetId);
          stack.push({ nodeId: targetId, edgeIndex: 0 });
        }
      } else {
        color.set(top.nodeId, 2);
        pathNodes.pop();
        stack.pop();
      }
    }
  }
}
