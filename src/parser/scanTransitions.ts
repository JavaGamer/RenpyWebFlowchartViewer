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
  const keywordMatch = /^(if|elif|else)\b/.exec(trimmed);
  if (!keywordMatch) return null;
  const kind = keywordMatch[1] as ConditionalBranchKind;
  const headerColonIndex = findTopLevelHeaderColon(trimmed);
  if (headerColonIndex < 0) return null;

  const headerPrefix = trimmed.slice(0, headerColonIndex).trim();
  if (kind === 'else') {
    return headerPrefix === 'else' ? { kind: 'else', expression: null } : null;
  }

  if (!headerPrefix.startsWith(kind)) return null;
  const expression = headerPrefix.slice(kind.length).trim();
  if (!expression) return null;
  return { kind, expression };
}

function findTopLevelHeaderColon(text: string): number {
  let parenDepth = 0;
  let bracketDepth = 0;
  let braceDepth = 0;
  let activeQuote: '"' | '\'' | null = null;
  let tripleQuoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (activeQuote) {
      if (tripleQuoted) {
        if (i + 2 < text.length && char === activeQuote && text[i + 1] === activeQuote && text[i + 2] === activeQuote) {
          i += 2;
          activeQuote = null;
          tripleQuoted = false;
        }
        continue;
      }
      if (char === '\\') {
        if (i + 1 < text.length) {
          i += 1;
        } else {
          break;
        }
        continue;
      }
      if (char === activeQuote) {
        activeQuote = null;
      }
      continue;
    }

    if ((char === '"' || char === '\'') && i + 2 < text.length && text[i + 1] === char && text[i + 2] === char) {
      activeQuote = char;
      tripleQuoted = true;
      i += 2;
      continue;
    }
    if (char === '"' || char === '\'') {
      activeQuote = char;
      tripleQuoted = false;
      continue;
    }

    if (char === '#') {
      break;
    }

    if (char === '(') {
      parenDepth += 1;
      continue;
    }
    if (char === ')') {
      parenDepth -= 1;
      if (parenDepth < 0) return -1;
      continue;
    }
    if (char === '[') {
      bracketDepth += 1;
      continue;
    }
    if (char === ']') {
      bracketDepth -= 1;
      if (bracketDepth < 0) return -1;
      continue;
    }
    if (char === '{') {
      braceDepth += 1;
      continue;
    }
    if (char === '}') {
      braceDepth -= 1;
      if (braceDepth < 0) return -1;
      continue;
    }

    if (char === ':' && parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) {
      return i;
    }
  }

  return -1;
}
