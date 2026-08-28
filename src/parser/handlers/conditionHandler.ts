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
  const decisionContext = scanState
    .conditionalDecisionStack[scanState.conditionalDecisionStack.length - 1];
  if (decisionContext) {
    return decisionContext.decisionNodeId;
  }
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
  if (pending.expression) {
    if (!state.allConditionalExpressions) {
      state.allConditionalExpressions = [];
    }
    state.allConditionalExpressions.push({
      expression: pending.expression,
      branchKind: pending.kind,
      chapter,
      sourceId: source,
      sourceLocation: pending.sourceLocation,
    });
  }
  if (
    pending.kind === "if" || pending.kind === "while" ||
    pending.kind === "for" ||
    pending.kind === "match"
  ) {
    state.decisionCounter += 1;
    const decisionNodeId = `decision_${state.decisionCounter}`;
    const references = extractConditionFlagRefs(
      pending.expression ?? undefined,
    );
    const labelPrefix = pending.kind;
    addNode(state, {
      id: decisionNodeId,
      type: "DECISION",
      label: pending.expression
        ? `${labelPrefix} ${pending.expression}`
        : labelPrefix,
      dialogueCount: 0,
      chapter,
      parentLabelId: scanState.currentLabelId ?? undefined,
      condition: {
        branchKind: pending.kind,
        expression: pending.expression ?? undefined,
        references,
        decisionNodeId,
      },
      sourceLocation: pending.sourceLocation,
    });
    const parentContext = scanState
      .conditionalDecisionStack[scanState.conditionalDecisionStack.length - 1];
    addEdge(state, {
      id: `seq_${source}__${decisionNodeId}`,
      source,
      target: decisionNodeId,
      kind: "sequence",
      label: parentContext ? parentContext.branchKind : labelPrefix,
      condition: parentContext
        ? {
          branchKind: parentContext.branchKind,
          expression: parentContext.expression ?? undefined,
          references: parentContext.references,
          decisionNodeId: parentContext.decisionNodeId,
        }
        : undefined,
      sourceLocation: pending.sourceLocation,
    });
    addOutgoing(state, source, "sequence");
    addIncoming(state, decisionNodeId, "sequence");
    scanState.conditionalDecisionStack.push({
      indent: pending.indent,
      decisionNodeId,
      sourceId: source,
      branchKind: pending.kind,
      expression: pending.expression,
      references,
      sourceLocation: pending.sourceLocation,
    });
    scanState.pendingConditionalHeader = null;
    return true;
  }

  if (pending.kind === "case") {
    const matchContext = [...scanState.conditionalDecisionStack]
      .reverse()
      .find((c) => c.branchKind === "match");
    if (!matchContext) {
      scanState.pendingConditionalHeader = null;
      return false;
    }
    const rawPattern = (pending.expression ?? "").trim();
    let synthesizedExpr: string | undefined;
    if (rawPattern) {
      let patPart = rawPattern;
      let guardPart: string | undefined;
      if (/\s+if\s+/.test(rawPattern)) {
        const parts = rawPattern.split(/\s+if\s+/);
        patPart = parts[0]!.trim();
        guardPart = parts.slice(1).join(" if ").trim();
      }

      if (patPart === "_") {
        synthesizedExpr = guardPart ? guardPart : undefined;
      } else if (matchContext.expression) {
        const orSegments = patPart
          .split(/\s*\|\s*/)
          .map((s) => s.trim())
          .filter(Boolean);
        if (orSegments.length > 1) {
          const comparisons = orSegments.map((seg) =>
            seg === "_" ? "True" : `((${matchContext.expression}) == (${seg}))`
          );
          const disjunction = `(${comparisons.join(" or ")})`;
          synthesizedExpr = guardPart
            ? `(${disjunction}) and (${guardPart})`
            : disjunction;
        } else {
          synthesizedExpr = guardPart
            ? `((${matchContext.expression}) == (${patPart})) and (${guardPart})`
            : `(${matchContext.expression}) == (${patPart})`;
        }
      } else {
        synthesizedExpr = guardPart
          ? `(${patPart}) and (${guardPart})`
          : patPart;
      }
    }
    const references = extractConditionFlagRefs(
      synthesizedExpr ?? pending.expression ?? undefined,
    );
    const top = scanState
      .conditionalDecisionStack[scanState.conditionalDecisionStack.length - 1];
    if (top && top.branchKind === "case" && top.indent === pending.indent) {
      scanState.conditionalDecisionStack.pop();
    }
    scanState.conditionalDecisionStack.push({
      indent: pending.indent,
      decisionNodeId: matchContext.decisionNodeId,
      sourceId: matchContext.sourceId,
      branchKind: "case",
      expression: synthesizedExpr ?? null,
      references,
      sourceLocation: pending.sourceLocation,
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
  const references = extractConditionFlagRefs(
    pending.expression ?? undefined,
  );
  // Construct a new context representation for elif/else instead of mutating existing in-place
  scanState
    .conditionalDecisionStack[scanState.conditionalDecisionStack.length - 1] = {
      indent: pending.indent,
      decisionNodeId: existing.decisionNodeId,
      sourceId: existing.sourceId,
      branchKind: pending.kind,
      expression: pending.expression,
      references,
      sourceLocation: pending.sourceLocation ?? existing.sourceLocation,
    };
  scanState.pendingConditionalHeader = null;
  return true;
}
