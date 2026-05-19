import { PARSER_TOKENS } from '../parserTokens';
import type { ParseScanState } from './pipelineTypes';
import type { ConditionalBranchKind } from './pipelineTypes';

export function parentMenuStackLength(menuDepth: number): number {
  return Math.max(0, menuDepth - 1);
}

export function menuAtDepth(
  menuStack: { id: string; optionText: string | null }[],
  depth: number,
): { id: string; optionText: string | null } | null {
  return depth > 0 ? (menuStack[depth - 1] ?? null) : null;
}

export function edgeIdWithOption(base: string, optionText: string | null | undefined): string {
  return optionText ? `${base}_${optionText}` : base;
}

export function maybeUpdateConditionalState(
  scanState: ParseScanState,
  type: number,
  getTokenText: () => string,
  indent: number,
  lineText?: string,
) {
  if (!scanState.conditionalDecisionStack) {
    scanState.conditionalDecisionStack = [];
  }
  if (scanState.pendingConditionalHeader === undefined) {
    scanState.pendingConditionalHeader = null;
  }
  if (type === PARSER_TOKENS.charWhitespace || type === PARSER_TOKENS.charNewline) {
    return;
  }

  scanState.pendingConditionalHeader = null;

  while (
    scanState.conditionalIndentStack.length > 0 &&
    indent <= scanState.conditionalIndentStack[scanState.conditionalIndentStack.length - 1]
  ) {
    scanState.conditionalIndentStack.pop();
  }
  while (scanState.conditionalDecisionStack.length > 0) {
    const top = scanState.conditionalDecisionStack[scanState.conditionalDecisionStack.length - 1]!;
    if (indent < top.indent) {
      scanState.conditionalDecisionStack.pop();
      continue;
    }
    if (indent === top.indent && type !== PARSER_TOKENS.kwConditional) {
      scanState.conditionalDecisionStack.pop();
      continue;
    }
    break;
  }

  if (type !== PARSER_TOKENS.kwConditional) return;
  const tokenText = getTokenText();
  if (tokenText === 'if' || tokenText === 'elif' || tokenText === 'else' || tokenText === 'while') {
    scanState.conditionalIndentStack.push(indent);
  }
  const parsedHeader = parseConditionalHeader(lineText ?? tokenText);
  if (!parsedHeader) return;
  scanState.pendingConditionalHeader = { ...parsedHeader, indent };
}

function parseConditionalHeader(lineText: string): {
  kind: ConditionalBranchKind;
  expression: string | null;
} | null {
  const trimmed = lineText.trim();
  const ifMatch = /^if\s+(.+?)\s*:\s*(?:#.*)?$/.exec(trimmed);
  if (ifMatch) {
    return { kind: 'if', expression: ifMatch[1]?.trim() ?? null };
  }
  const elifMatch = /^elif\s+(.+?)\s*:\s*(?:#.*)?$/.exec(trimmed);
  if (elifMatch) {
    return { kind: 'elif', expression: elifMatch[1]?.trim() ?? null };
  }
  if (/^else\s*:\s*(?:#.*)?$/.test(trimmed)) {
    return { kind: 'else', expression: null };
  }
  return null;
}
