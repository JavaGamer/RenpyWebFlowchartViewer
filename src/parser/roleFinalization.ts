import type { ParseGraphState } from "./pipelineTypes.ts";
import { materializeCallReturnEdges } from "./callReturnFinalization.ts";
import { classifyNodeRole } from "./roleClassification.ts";
import { normalizeGraphState } from "./graphNormalization.ts";
import { addParseDiagnostic } from "./diagnostics.ts";
import { runControlFlowAnalysis } from "./controlFlowAnalysis.ts";

function emitShadowedTargetResolutionDiagnostics(state: ParseGraphState): void {
  const shadowedCanonicalIds = new Set<string>();
  for (
    const [labelName, definitionCount] of state.labelDefinitionCountByName
      .entries()
  ) {
    if (definitionCount <= 1) continue;
    const canonicalId = state.canonicalLabelIdByName.get(labelName) ??
      labelName;
    shadowedCanonicalIds.add(canonicalId);
  }
  if (shadowedCanonicalIds.size === 0) return;

  for (const edge of state.edges) {
    if (!edge.kind || (edge.kind !== "jump" && edge.kind !== "call")) continue;
    if (!shadowedCanonicalIds.has(edge.target)) continue;
    addParseDiagnostic(
      state,
      {
        code: "shadowed_label",
        severity: "warning",
        location: {
          edgeId: edge.id,
          sourceId: edge.source,
          targetId: edge.target,
          sourceLocation: edge.sourceLocation,
        },
        context: {
          category: "shadowed_target_resolution",
          detail: edge.target,
        },
        message:
          `Edge "${edge.id}" resolves to canonical label "${edge.target}" while duplicate shadowed definitions exist for that label name.`,
        recoveryAction:
          "Rename duplicate labels or keep one canonical definition to remove ambiguous target resolution.",
      },
      `shadowed_target_resolution|${edge.id}|${edge.source}|${edge.target}`,
    );
  }
}

function decisionTreeHasExit(
  state: ParseGraphState,
  decisionId: string,
  visited: Set<string>,
  originatingLabelId?: string,
): boolean {
  if (visited.has(decisionId)) return false;
  visited.add(decisionId);

  const outEdges = state.edges.filter((e) => e.source === decisionId);
  for (const edge of outEdges) {
    if (edge.kind === "jump" || edge.kind === "call") return true;
    if (edge.kind === "sequence") {
      if (originatingLabelId && edge.target === originatingLabelId) continue;
      const targetNode = state.nodeMap.get(edge.target);
      if (!targetNode || targetNode.type !== "DECISION") return true;
      if (
        decisionTreeHasExit(state, edge.target, visited, originatingLabelId)
      ) {
        return true;
      }
    }
  }
  return false;
}

function labelHasForwardFlow(state: ParseGraphState, labelId: string): boolean {
  const outgoing = state.outgoingByLabel.get(labelId);
  if (!outgoing) return false;
  if (outgoing.has("jump") || outgoing.has("call")) return true;
  if (!outgoing.has("sequence")) return false;

  const outEdges = state.edges.filter((e) => e.source === labelId);
  for (const edge of outEdges) {
    if (edge.kind === "jump" || edge.kind === "call") return true;
    if (edge.kind === "sequence") {
      if (edge.target === labelId) continue;
      const targetNode = state.nodeMap.get(edge.target);
      if (!targetNode || targetNode.type !== "DECISION") return true;
      if (decisionTreeHasExit(state, edge.target, new Set<string>(), labelId)) {
        return true;
      }
    }
  }
  return false;
}

export function finalizeRoles(state: ParseGraphState) {
  materializeCallReturnEdges(state);
  normalizeGraphState(state);
  emitShadowedTargetResolutionDiagnostics(state);

  if (state.nodeMutations && state.nodeMutations.size > 0) {
    for (const node of state.nodes) {
      const muts = state.nodeMutations.get(node.id);
      if (muts && muts.length > 0) {
        node.mutations = muts;
      }
    }
  }

  for (const node of state.nodes) {
    node.role = classifyNodeRole(state, node);
    if (node.type !== "LABEL") {
      node.isTerminalOutcome = false;
      continue;
    }
    const hasForwardFlow = labelHasForwardFlow(state, node.id);
    node.isTerminalOutcome = node.role === "story" && !hasForwardFlow;
  }

  runControlFlowAnalysis(state);
}
