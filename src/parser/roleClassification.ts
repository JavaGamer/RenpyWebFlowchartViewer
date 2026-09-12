import type { FlowNode } from "../domain/index.ts";
import type { ParseGraphState } from "./pipelineTypes.ts";
import { getParserVariantPlugin } from "../config/parserRules.ts";

/**
 * Assigns a specific semantic role to a flowchart node based on its AST type and graph topology.
 * Classification logic:
 * 1. Menus and Decisions are automatically assigned 'menu' and 'decision' roles respectively.
 * 2. Labels are classified into four sub-roles:
 *    - `state_toggle`: A label that returns without any linear narrative sequence or jump traffic,
 *      typically representing side-effect logic (e.g. setting variables, updating state).
 *    - `detour`: An optional story branch called from menu options that returns flow to the menu caller.
 *    - `utility`: A reusable subroutine (e.g. a shared cutscene or system helper) called from multiple locations,
 *      or explicitly matched by the variant's utilityLabelPatterns.
 *    - `story`: Standard sequential blocks in the main storyline.
 *
 * @param state The global parser graph assembly state containing incoming/outgoing traffic collections.
 * @param node The node being classified.
 * @returns The classified NodeRole.
 */
function getBaseLabelId(id: string): string {
  const idx = id.indexOf("__scene_");
  return idx !== -1 ? id.slice(0, idx) : id;
}

/**
 * Checks whether a label node has sequence or jump traffic connecting to external nodes
 * (i.e. not internal child decisions or internal menus belonging to the same label,
 * and not internal scene splits within the same base label).
 */
function hasExternalStoryTraffic(
  state: ParseGraphState,
  labelId: string,
): boolean {
  if (state.edges.length === 0) {
    const incoming = state.incomingByLabel.get(labelId);
    const outgoing = state.outgoingByLabel.get(labelId);
    return Boolean(
      incoming?.has("sequence") ||
        outgoing?.has("sequence") ||
        incoming?.has("jump") ||
        outgoing?.has("jump"),
    );
  }

  const baseLabelId = getBaseLabelId(labelId);

  for (const edge of state.edges) {
    if (edge.kind !== "sequence" && edge.kind !== "jump") continue;
    if (edge.source === edge.target) continue;

    if (edge.target === labelId) {
      const sourceNode = state.nodeMap.get(edge.source);
      if (!sourceNode) return true;
      if (sourceNode.type === "LABEL") {
        if (getBaseLabelId(sourceNode.id) !== baseLabelId) {
          return true;
        }
      } else if (
        (sourceNode.type === "DECISION" || sourceNode.type === "MENU") &&
        sourceNode.parentLabelId !== labelId
      ) {
        return true;
      }
    }

    if (edge.source === labelId) {
      const targetNode = state.nodeMap.get(edge.target);
      if (!targetNode) return true;
      if (targetNode.type === "LABEL") {
        if (getBaseLabelId(targetNode.id) !== baseLabelId) {
          return true;
        }
      } else if (
        (targetNode.type === "DECISION" || targetNode.type === "MENU") &&
        targetNode.parentLabelId !== labelId
      ) {
        return true;
      }
    }
  }

  return false;
}

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

  // Check variant utilityLabelPatterns
  if (state.parserVariant) {
    const plugin = getParserVariantPlugin(state.parserVariant);
    if (plugin.utilityLabelPatterns && plugin.utilityLabelPatterns.length > 0) {
      for (const pattern of plugin.utilityLabelPatterns) {
        pattern.lastIndex = 0;
        if (pattern.test(node.label)) {
          return "utility";
        }
      }
    }
  }

  const hasReturn = state.hasReturnInLabel.has(node.id);
  const isCalled = state.calledLabels.has(node.id);
  const isCalledFromMenuOption = state.calledFromMenuOptionTargets.has(node.id);

  const hasExternalTraffic = hasExternalStoryTraffic(state, node.id);

  if (isCalled && hasReturn) {
    if (isCalledFromMenuOption) {
      return "detour";
    }
    if (!hasExternalTraffic) {
      return "utility";
    }
  }

  const incoming = state.incomingByLabel.get(node.id);
  const outgoing = state.outgoingByLabel.get(node.id);
  const hasStoryTraffic = Boolean(
    incoming?.has("sequence") ||
      outgoing?.has("sequence") ||
      incoming?.has("jump") ||
      outgoing?.has("jump"),
  );

  if (hasReturn && !hasStoryTraffic && !isCalled) {
    return "state_toggle";
  }
  return "story";
}
