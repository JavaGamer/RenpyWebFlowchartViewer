import type {
  ParseGraphState,
  ParseScanState,
  TokenMetaFlags,
} from "../pipelineTypes.ts";
import {
  type ConditionMetadata,
  extractConditionFlagRefs,
} from "../../domain/index.ts";
import { menuAtDepth } from "../scanTransitions.ts";
import {
  addEdge,
  addIncoming,
  addNode,
  addOutgoing,
} from "../graphMutations.ts";

export function createDecisionConditionMetadata(
  decisionContext:
    | ParseScanState["conditionalDecisionStack"][number]
    | undefined,
): ConditionMetadata | undefined {
  if (!decisionContext) return undefined;
  return {
    branchKind: decisionContext.branchKind,
    expression: decisionContext.expression ?? undefined,
    references: decisionContext.references,
    decisionNodeId: decisionContext.decisionNodeId,
  };
}

export function resolveConditionalSource(
  scanState: ParseScanState,
  meta: TokenMetaFlags,
  menuDepth: number,
): string | null {
  if (meta.hasMenuOptionBlock) {
    const menu = menuAtDepth(scanState.menuStack, menuDepth);
    return menu?.id ?? scanState.currentLabelId;
  }
  return scanState.currentLabelId;
}

/**
 * Processes conditional keyword transitions (if, elif, else), creating
 * a decision node in the graph and managing the conditional decision stack.
 */
export function handleConditionalHeader(
  state: ParseGraphState,
  scanState: ParseScanState,
  meta: TokenMetaFlags,
  menuDepth: number,
  chapter: string,
): boolean {
  const pending = scanState.pendingConditionalHeader;
  if (!pending || scanState.currentLabelId === null) return false;
  const source = resolveConditionalSource(scanState, meta, menuDepth);
  if (!source) return false;
  if (pending.kind === "if") {
    state.decisionCounter += 1;
    const decisionNodeId = `decision_${state.decisionCounter}`;
    const references = extractConditionFlagRefs(
      pending.expression ?? undefined,
    );
    for (const ref of references) {
      state.referencedVariables.push({
        varName: ref,
        location: {
          chapter,
          construct: "condition",
          sourceId: source,
        },
      });
    }
    addNode(state, {
      id: decisionNodeId,
      type: "DECISION",
      label: pending.expression ? `if ${pending.expression}` : "if",
      dialogueCount: 0,
      chapter,
      parentLabelId: scanState.currentLabelId ?? undefined,
      condition: {
        branchKind: "if",
        expression: pending.expression ?? undefined,
        references,
        decisionNodeId,
      },
    });
    addEdge(state, {
      id: `seq_${source}__${decisionNodeId}`,
      source,
      target: decisionNodeId,
      kind: "sequence",
      label: "if",
    });
    addOutgoing(state, source, "sequence");
    addIncoming(state, decisionNodeId, "sequence");
    scanState.conditionalDecisionStack.push({
      indent: pending.indent,
      decisionNodeId,
      sourceId: source,
      branchKind: "if",
      expression: pending.expression,
      references,
    });
    scanState.pendingConditionalHeader = null;
    return true;
  }
  const existing = scanState
    .conditionalDecisionStack[scanState.conditionalDecisionStack.length - 1];
  if (!existing || existing.indent !== pending.indent) {
    scanState.pendingConditionalHeader = null;
    return false;
  }
  existing.branchKind = pending.kind;
  existing.expression = pending.expression;
  existing.references = extractConditionFlagRefs(
    pending.expression ?? undefined,
  );
  scanState.pendingConditionalHeader = null;
  return true;
}
