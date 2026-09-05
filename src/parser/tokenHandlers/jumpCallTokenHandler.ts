import type {
  ParseGraphState,
  ParseScanState,
  TokenMetaFlags,
} from "../pipelineTypes.ts";
import {
  addDynamicTargetDiagnostic,
  emitCallEdge,
  emitJumpEdge,
  parseCallArguments,
  resolveCallContext,
  resolveExpressionTargets,
} from "../handlers/jumpCallHandler.ts";
import {
  areAllPathsCoveredByPendingMenus,
  menuAtDepth,
} from "../scanTransitions.ts";
import type { SourceLocation } from "../../domain/index.ts";

export function handleScreenKeywordToken(scanState: ParseScanState): void {
  scanState.waitForCallTarget = false;
  scanState.waitForCallExpressionTarget = false;
  scanState.waitForJumpTarget = false;
  scanState.waitForJumpExpressionTarget = false;
}

export function handleExpressionKeywordToken(scanState: ParseScanState): void {
  if (scanState.waitForJumpTarget) {
    scanState.waitForJumpExpressionTarget = true;
  }
  if (scanState.waitForCallTarget) {
    scanState.waitForCallExpressionTarget = true;
  }
}

export function handleJumpKeywordToken(scanState: ParseScanState): void {
  scanState.currentLabelHasContentSinceSceneBoundary = true;
  scanState.waitForJumpTarget = true;
  scanState.waitForJumpExpressionTarget = false;
}

import { stripInlineComment } from "../handlers/screen/screenHandlerEntry.ts";

function extractTargetExpressionClause(
  lineText: string,
  prefixPattern: RegExp,
): string | null {
  const clean = stripInlineComment(lineText).trim();
  const match = prefixPattern.exec(clean);
  if (!match) return null;
  const startIdx = match.index + match[0].length;
  let depth = 0;
  let inQuote: string | null = null;
  for (let i = startIdx; i < clean.length; i++) {
    const ch = clean[i]!;
    if (inQuote) {
      if (ch === "\\" && i + 1 < clean.length) i++;
      else if (ch === inQuote) inQuote = null;
    } else if (ch === '"' || ch === "'") {
      inQuote = ch;
    } else if (ch === "(" || ch === "[" || ch === "{") {
      depth++;
    } else if (ch === ")" || ch === "]" || ch === "}") {
      depth = Math.max(0, depth - 1);
    } else if (depth === 0) {
      const rest = clean.slice(i);
      if (/^\s+(?:pass|from)\b/i.test(rest)) {
        return clean.slice(startIdx, i).trim();
      }
    }
  }
  return clean.slice(startIdx).trim();
}

export function handleJumpTargetToken(
  state: ParseGraphState,
  scanState: ParseScanState,
  val: () => string,
  lineText: string,
  chapter: string,
  meta: TokenMetaFlags,
  menuDepth: number,
  sourceLocation?: SourceLocation,
): void {
  let rawExpr = val();
  if (scanState.waitForJumpExpressionTarget && lineText) {
    const extracted = extractTargetExpressionClause(
      lineText,
      /jump\s+expression\s+/i,
    );
    rawExpr = extracted && extracted.length > 0 ? extracted : val();
  }
  const targetExpression = rawExpr;
  const targets = resolveExpressionTargets(
    scanState,
    targetExpression,
    scanState.waitForJumpExpressionTarget,
    state,
  );
  const context = resolveCallContext(scanState, meta, menuDepth);
  if (targets.length === 0) {
    addDynamicTargetDiagnostic(
      state,
      chapter,
      "jump expression",
      targetExpression,
      context.source ?? undefined,
    );
    const isReliableJumpExit = scanState.conditionalIndentStack.length === 0 &&
      !meta.hasMenuOptionBlock;
    if (isReliableJumpExit) {
      scanState.labelHasExplicitExit = true;
    }
    scanState.waitForJumpTarget = false;
    scanState.waitForJumpExpressionTarget = false;
    return;
  }
  const pendingFallthrough =
    (!context.isInOption && scanState.pendingMenuFallthrough.length > 0)
      ? [...scanState.pendingMenuFallthrough]
      : null;
  for (const target of targets) {
    if (pendingFallthrough) {
      scanState.pendingMenuFallthrough = [...pendingFallthrough];
    }
    emitJumpEdge(
      state,
      scanState,
      target,
      { ...context, sourceLocation },
      true,
    );
  }
  if (pendingFallthrough) {
    scanState.pendingMenuFallthrough = [];
  }
  scanState.waitForJumpTarget = false;
  scanState.waitForJumpExpressionTarget = false;
}

export function handleCallKeywordToken(scanState: ParseScanState): void {
  scanState.currentLabelHasContentSinceSceneBoundary = true;
  scanState.waitForCallTarget = true;
  scanState.waitForCallExpressionTarget = false;
}

export function handleCallTargetToken(
  state: ParseGraphState,
  scanState: ParseScanState,
  val: () => string,
  lineText: string,
  chapter: string,
  meta: TokenMetaFlags,
  menuDepth: number,
  sourceLocation?: SourceLocation,
): void {
  let rawExpr = val();
  if (scanState.waitForCallExpressionTarget && lineText) {
    const extracted = extractTargetExpressionClause(
      lineText,
      /call\s+expression\s+/i,
    );
    rawExpr = extracted && extracted.length > 0 ? extracted : val();
  }
  const targetExpression = rawExpr;
  const targets = resolveExpressionTargets(
    scanState,
    targetExpression,
    Boolean(scanState.waitForCallExpressionTarget),
    state,
  );
  const context = resolveCallContext(scanState, meta, menuDepth);
  const callArgs = parseCallArguments(lineText);
  if (targets.length === 0) {
    addDynamicTargetDiagnostic(
      state,
      chapter,
      "call expression",
      targetExpression,
      context.source ?? undefined,
    );
    scanState.waitForCallTarget = false;
    scanState.waitForCallExpressionTarget = false;
    return;
  }
  const pendingFallthrough =
    (!context.isInOption && scanState.pendingMenuFallthrough.length > 0)
      ? [...scanState.pendingMenuFallthrough]
      : null;
  for (const target of targets) {
    if (pendingFallthrough) {
      scanState.pendingMenuFallthrough = [...pendingFallthrough];
    }
    emitCallEdge(
      state,
      scanState,
      target,
      { ...context, sourceLocation },
      callArgs,
    );
  }
  if (pendingFallthrough) {
    scanState.pendingMenuFallthrough = [];
  }
  scanState.waitForCallTarget = false;
  scanState.waitForCallExpressionTarget = false;
}

export function handleReturnKeywordToken(
  state: ParseGraphState,
  scanState: ParseScanState,
  meta: TokenMetaFlags,
): void {
  if (meta.hasMenuOptionBlock) {
    const menu = menuAtDepth(scanState.menuStack, scanState.menuStack.length);
    if (menu && menu.options) {
      const lastOpt = menu.options[menu.options.length - 1];
      if (lastOpt) {
        lastOpt.hasExit = true;
      }
    }
    if (scanState.currentLabelId !== null) {
      state.hasReturnInLabel.add(scanState.currentLabelId);
    }
  } else {
    scanState.currentLabelHasContentSinceSceneBoundary = true;
    const isReliableReturn = scanState.conditionalIndentStack.length === 0;
    if (scanState.conditionalDecisionStack.length > 0) {
      const decCtx = scanState.conditionalDecisionStack[
        scanState.conditionalDecisionStack.length - 1
      ]!;
      decCtx.currentBranchHasExit = true;
    }
    if (scanState.pendingMenuFallthrough.length > 0) {
      const allCoveredByMenus = areAllPathsCoveredByPendingMenus(
        state,
        scanState,
      );
      for (const entry of scanState.pendingMenuFallthrough) {
        state.hasReturnInLabel.add(entry.menuId);
        if (isReliableReturn) {
          state.hasReliableReturnInLabel.add(entry.menuId);
        }
      }
      scanState.pendingMenuFallthrough = [];
      if (!allCoveredByMenus && scanState.currentLabelId !== null) {
        state.hasReturnInLabel.add(scanState.currentLabelId);
        if (isReliableReturn) {
          state.hasReliableReturnInLabel.add(scanState.currentLabelId);
        }
      }
      if (isReliableReturn) {
        scanState.labelHasExplicitExit = true;
      }
    } else {
      if (isReliableReturn && scanState.currentLabelId !== null) {
        scanState.labelHasExplicitExit = true;
        state.hasReliableReturnInLabel.add(scanState.currentLabelId);
      }
      if (scanState.currentLabelId !== null) {
        state.hasReturnInLabel.add(scanState.currentLabelId);
      }
    }
  }
}
