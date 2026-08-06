import type { FlowNode } from "../domain/index.ts";
import type { ParseGraphState } from "./pipelineTypes.ts";

/**
 * Assigns a specific semantic role to a flowchart node based on its AST type and graph topology.
 * Classification logic:
 * 1. Menus and Decisions are automatically assigned 'menu' and 'decision' roles respectively.
 * 2. Labels are classified into four sub-roles:
 *    - `state_toggle`: A label that returns without any linear narrative sequence or jump traffic,
 *      typically representing side-effect logic (e.g. setting variables, updating state).
 *    - `detour`: An optional story branch called from menu options that returns flow to the menu caller.
 *    - `utility`: A reusable subroutine (e.g. a shared cutscene or system helper) called from multiple locations.
 *    - `story`: Standard sequential blocks in the main storyline.
 *
 * @param state The global parser graph assembly state containing incoming/outgoing traffic collections.
 * @param node The node being classified.
 * @returns The classified NodeRole.
 */
export function classifyNodeRole(
  state: ParseGraphState,
  node: FlowNode,
): FlowNode["role"] {
  if (node.type === "MENU") return "menu";
  if (node.type === "DECISION") {
    if (node.condition?.branchKind === "while") return "while_loop";
    if (node.condition?.branchKind === "for") return "for_loop";
    return "decision";
  }

  const incoming = state.incomingByLabel.get(node.id);
  const outgoing = state.outgoingByLabel.get(node.id);
  const hasReturn = state.hasReturnInLabel.has(node.id);
  const isCalled = state.calledLabels.has(node.id);
  const isCalledFromMenuOption = state.calledFromMenuOptionTargets.has(node.id);
  const hasStoryTraffic = Boolean(
    incoming?.has("sequence") ||
      outgoing?.has("sequence") ||
      incoming?.has("jump") ||
      outgoing?.has("jump"),
  );

  if (hasReturn && !hasStoryTraffic && !isCalled) {
    return "state_toggle";
  }
  if (isCalledFromMenuOption && hasReturn) {
    return "detour";
  }
  if (isCalled && hasReturn && !hasStoryTraffic) {
    return "utility";
  }
  return "story";
}
