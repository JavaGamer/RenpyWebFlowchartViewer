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

export function finalizeRoles(state: ParseGraphState) {
  materializeCallReturnEdges(state);
  normalizeGraphState(state);
  emitShadowedTargetResolutionDiagnostics(state);

  for (const node of state.nodes) {
    node.role = classifyNodeRole(state, node);
    if (node.type !== "LABEL") {
      node.isTerminalOutcome = false;
      continue;
    }
    const outgoing = state.outgoingByLabel.get(node.id);
    const hasForwardFlow = Boolean(
      outgoing?.has("sequence") ||
        outgoing?.has("jump") ||
        outgoing?.has("call"),
    );
    node.isTerminalOutcome = node.role === "story" && !hasForwardFlow;
  }

  runControlFlowAnalysis(state);
}
