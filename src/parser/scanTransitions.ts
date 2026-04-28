import { PARSER_TOKENS } from '../parserTokens';
import type { ParseScanState } from './pipelineTypes';

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
) {
  if (type === PARSER_TOKENS.charWhitespace || type === PARSER_TOKENS.charNewline) {
    return;
  }

  while (
    scanState.conditionalIndentStack.length > 0 &&
    indent <= scanState.conditionalIndentStack[scanState.conditionalIndentStack.length - 1]
  ) {
    scanState.conditionalIndentStack.pop();
  }

  if (type !== PARSER_TOKENS.kwConditional) return;
  const tokenText = getTokenText();
  if (tokenText === 'if' || tokenText === 'elif' || tokenText === 'else' || tokenText === 'while') {
    scanState.conditionalIndentStack.push(indent);
  }
}
