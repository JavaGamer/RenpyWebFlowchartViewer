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
import { menuAtDepth } from "../scanTransitions.ts";
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
    const clean = lineText.split("#")[0]!.trim();
    const match = /jump\s+expression\s+(.+?)(?:\s+from\b|$)/i.exec(clean);
    rawExpr = match
      ? match[1]!.trim()
      : (clean.includes("expression")
        ? clean.substring(clean.indexOf("expression") + 10).trim()
        : val());
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
  for (const target of targets) {
    emitJumpEdge(
      state,
      scanState,
      target,
      { ...context, sourceLocation },
      true,
    );
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
    const clean = lineText.split("#")[0]!.trim();
    const match = /call\s+expression\s+(.+?)(?:\s+pass\b|\s+from\b|$)/i.exec(
      clean,
    );
    rawExpr = match
      ? match[1]!.trim()
      : (clean.includes("expression")
        ? clean.substring(clean.indexOf("expression") + 10).trim()
        : val());
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
  for (const target of targets) {
    emitCallEdge(
      state,
      scanState,
      target,
      { ...context, sourceLocation },
      callArgs,
    );
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
    if (isReliableReturn && scanState.currentLabelId !== null) {
      scanState.labelHasExplicitExit = true;
      state.hasReliableReturnInLabel.add(scanState.currentLabelId);
    }
    if (scanState.currentLabelId !== null) {
      state.hasReturnInLabel.add(scanState.currentLabelId);
    }
  }
}
