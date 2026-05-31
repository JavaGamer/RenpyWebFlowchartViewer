import type { TextDocument } from 'vscode-languageserver-textdocument';
import type { TokenTree, TreeNode } from '@renpy/ast/out/tokenizer/token-definitions';
import type { ParseGraphState, ParseScanState } from './pipelineTypes';
import { analyzeTokenMetaInto, createEmptyTokenMeta } from './tokenMeta';
import { maybeUpdateConditionalState } from './scanTransitions';
import { handleToken } from './tokenHandling';
import { PARSER_TOKENS } from '../parserTokens';
import type { ParserVariant, ScreenActionRule } from '../config/parserRules';
import { toScreenActionRuleMap, type ScreenActionKind } from '../config/parserRules';

interface FlatTokenLike {
  type: number;
  metaTokens: Iterable<number>;
  startPos: { line: number; character: number };
  startOffset?: number;
  getValue: (document: TextDocument) => string;
}

const RELEVANT_TOKEN_TYPES = new Set<number>([
  ...PARSER_TOKENS.menuKeywordTypes,
  PARSER_TOKENS.kwLabel,
  PARSER_TOKENS.kwScene,
  PARSER_TOKENS.entityFunctionName,
  PARSER_TOKENS.kwJump,
  PARSER_TOKENS.kwCall,
  PARSER_TOKENS.kwReturn,
  PARSER_TOKENS.literalString,
  PARSER_TOKENS.kwConditional,
  PARSER_TOKENS.metaPythonBlock,
  PARSER_TOKENS.metaScreenBlock,
].filter((t): t is number => typeof t === 'number'));

function getLineIndent(
  document: TextDocument,
  lineNumber: number,
  cache: Map<number, number>,
): number {
  const cached = cache.get(lineNumber);
  if (cached !== undefined) {
    return cached;
  }
  const line = document.getText({
    start: { line: lineNumber, character: 0 },
    end: { line: lineNumber, character: Number.MAX_SAFE_INTEGER },
  });
  const match = line.match(/^[ \t]*/);
  const indent = match?.[0]?.length ?? 0;
  cache.set(lineNumber, indent);
  return indent;
}

function getLineText(
  document: TextDocument,
  lineNumber: number,
  cache: Map<number, string>,
): string {
  const cached = cache.get(lineNumber);
  if (cached !== undefined) {
    return cached;
  }
  const line = document.getText({
    start: { line: lineNumber, character: 0 },
    end: { line: lineNumber, character: Number.MAX_SAFE_INTEGER },
  });
  cache.set(lineNumber, line);
  return line;
}

function getConditionalLogicalLine(
  document: TextDocument,
  lineNumber: number,
  lineTextCache: Map<number, string>,
  logicalLineCache: Map<number, string>,
): string {
  const cached = logicalLineCache.get(lineNumber);
  if (cached !== undefined) {
    return cached;
  }

  let logicalText = getLineText(document, lineNumber, lineTextCache);
  let currentLine = lineNumber;
  let maxLine = lineNumber;
  const delimiterStack: Array<')' | ']' | '}'> = [];
  let activeQuote: '"' | '\'' | null = null;
  let tripleQuoted = false;
  let inComment = false;
  let explicitContinuation = false;

  const processLine = (lineText: string) => {
    let lastSignificantCharOutsideComment: string | null = null;
    for (let i = 0; i < lineText.length; i += 1) {
      const char = lineText[i] ?? '';
      if (inComment) {
        continue;
      }

      if (activeQuote) {
        if (tripleQuoted) {
          if (char === activeQuote && lineText[i + 1] === activeQuote && lineText[i + 2] === activeQuote) {
            i += 2;
            activeQuote = null;
            tripleQuoted = false;
          }
          continue;
        }
        if (char === '\\') {
          if (i + 1 < lineText.length) {
            i += 1;
          }
          continue;
        }
        if (char === activeQuote) {
          activeQuote = null;
        }
        continue;
      }

      if (char === '#') {
        inComment = true;
        continue;
      }
      if ((char === '"' || char === '\'') && lineText[i + 1] === char && lineText[i + 2] === char) {
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

      if (char === '(') {
        delimiterStack.push(')');
      } else if (char === '[') {
        delimiterStack.push(']');
      } else if (char === '{') {
        delimiterStack.push('}');
      } else if (char === ')' || char === ']' || char === '}') {
        if (char === delimiterStack[delimiterStack.length - 1]) {
          delimiterStack.pop();
        }
      }

      if (!/\s/.test(char)) {
        lastSignificantCharOutsideComment = char;
      }
    }
    explicitContinuation = lastSignificantCharOutsideComment === '\\';
    inComment = false;
  };

  processLine(logicalText);
  while ((explicitContinuation || delimiterStack.length > 0) && currentLine + 1 < document.lineCount) {
    currentLine += 1;
    const nextLine = getLineText(document, currentLine, lineTextCache);
    logicalText += `\n${nextLine}`;
    processLine(nextLine);
    maxLine = currentLine;
  }

  for (let i = lineNumber; i <= maxLine; i += 1) {
    logicalLineCache.set(i, logicalText);
  }
  return logicalText;
}

export function processFlatToken(
  state: ParseGraphState,
  scanState: ParseScanState,
  token: FlatTokenLike,
  document: TextDocument,
  chapter: string,
  captureDialogueLines: boolean,
  lineIndentCache: Map<number, number>,
  lineTextCache: Map<number, string> = new Map<number, string>(),
  conditionalLogicalLineCache: Map<number, string> = new Map<number, string>(),
  parserVariant?: ParserVariant,
  screenActionRules?: ScreenActionRule[],
  precomputedScreenActionRuleMap?: Map<string, ScreenActionKind>,
): void {
  const type = token.type as number;
  const meta = analyzeTokenMetaInto(token.metaTokens as Iterable<number>, createEmptyTokenMeta());
  const screenActionRuleMap = precomputedScreenActionRuleMap ?? toScreenActionRuleMap(parserVariant, screenActionRules);
  let tokenText: string | undefined;
  const val = (): string => {
    if (tokenText === undefined) {
      const raw = token.getValue(document);
      tokenText = type === PARSER_TOKENS.literalString ? normalizeLiteralString(raw) : raw;
    }
    return tokenText;
  };
  const menuDepth = meta.menuDepth;
  const lineIndent = getLineIndent(document, token.startPos.line, lineIndentCache);
  const lineText = getLineText(document, token.startPos.line, lineTextCache);
  const conditionalText = type === PARSER_TOKENS.kwConditional
    ? getConditionalLogicalLine(document, token.startPos.line, lineTextCache, conditionalLogicalLineCache)
    : lineText;

  maybeUpdateConditionalState(scanState, type, val, lineIndent, conditionalText);
  handleToken(state, scanState, {
    type,
    meta,
    val,
    chapter,
    menuDepth,
    lineIndent,
    lineText,
    captureDialogueLines,
    screenActionRuleMap,
  });
}

function* iterateStreamTokens(
  node: TreeNode,
  inheritedMeta: number[],
  startOffsetCache: WeakMap<TreeNode, number>,
): Generator<FlatTokenLike> {
  const token = node.token;
  const nextMeta = token ? [...inheritedMeta, token.type as number] : inheritedMeta;
  const orderedItems: Array<
    | { kind: 'token'; startOffset: number; token: NonNullable<TreeNode['token']> }
    | { kind: 'child'; startOffset: number; child: TreeNode }
  > = [];

  if (token && RELEVANT_TOKEN_TYPES.has(token.type as number)) {
    orderedItems.push({
      kind: 'token',
      startOffset: token.startPos.charStartOffset ?? Number.MAX_SAFE_INTEGER,
      token,
    });
  }

  for (const child of node.children) {
    orderedItems.push({
      kind: 'child',
      startOffset: getNodeStartOffset(child, startOffsetCache),
      child,
    });
  }

  orderedItems.sort((a, b) => a.startOffset - b.startOffset);

  for (const item of orderedItems) {
    if (item.kind === 'token') {
      yield {
        type: item.token.type as number,
        metaTokens: inheritedMeta,
        startPos: item.token.startPos,
        startOffset: item.startOffset,
        getValue: item.token.getValue.bind(item.token),
      };
    } else {
      yield* iterateStreamTokens(item.child, nextMeta, startOffsetCache);
    }
  }
}

function getNodeStartOffset(node: TreeNode, cache: WeakMap<TreeNode, number>): number {
  const cached = cache.get(node);
  if (cached !== undefined) return cached;
  let minOffset = node.token?.startPos.charStartOffset ?? Number.MAX_SAFE_INTEGER;
  for (const child of node.children) {
    const childOffset = getNodeStartOffset(child, cache);
    if (childOffset < minOffset) minOffset = childOffset;
  }
  cache.set(node, minOffset);
  return minOffset;
}

function normalizeLiteralString(raw: string): string {
  const match = /^(?:[rR]|[uU]|[bB]|[fF]|[rR][bB]|[bB][rR]|[rR][fF]|[fF][rR]|[rR][uU]|[uU][rR])?(?:("""|'''|"|')([\s\S]*?)\1)$/.exec(raw);
  if (match) {
    return match[2] ?? '';
  }
  return raw;
}

export function processTokenTreeStream(
  state: ParseGraphState,
  scanState: ParseScanState,
  tokenTree: TokenTree,
  document: TextDocument,
  chapter: string,
  captureDialogueLines = true,
  parserVariant?: ParserVariant,
  screenActionRules?: ScreenActionRule[],
): void {
  const meta = createEmptyTokenMeta();
  const screenActionRuleMap = toScreenActionRuleMap(parserVariant, screenActionRules);
  const startOffsetCache = new WeakMap<TreeNode, number>();
  const lineIndentCache = new Map<number, number>();
  const lineTextCache = new Map<number, string>();
  const conditionalLogicalLineCache = new Map<number, string>();
  for (const token of iterateStreamTokens(tokenTree.root, [], startOffsetCache)) {
    const type = token.type as number;
    analyzeTokenMetaInto(token.metaTokens as Iterable<number>, meta);
    let tokenText: string | undefined;
    const val = (): string => {
      if (tokenText === undefined) {
        const raw = token.getValue(document);
        tokenText = type === PARSER_TOKENS.literalString ? normalizeLiteralString(raw) : raw;
      }
      return tokenText;
    };
    const menuDepth = meta.menuDepth;
    const lineIndent = getLineIndent(document, token.startPos.line, lineIndentCache);
    const lineText = getLineText(document, token.startPos.line, lineTextCache);
    const conditionalText = type === PARSER_TOKENS.kwConditional
      ? getConditionalLogicalLine(document, token.startPos.line, lineTextCache, conditionalLogicalLineCache)
      : lineText;
    maybeUpdateConditionalState(scanState, type, val, lineIndent, conditionalText);
    handleToken(state, scanState, {
      type,
      meta,
      val,
      chapter,
      menuDepth,
      lineIndent,
      lineText,
      captureDialogueLines,
      screenActionRuleMap,
    });
  }
}

export function processFlatTokens(
  state: ParseGraphState,
  scanState: ParseScanState,
  tokens: Iterable<FlatTokenLike>,
  document: TextDocument,
  chapter: string,
  captureDialogueLines: boolean,
  parserVariant?: ParserVariant,
  screenActionRules?: ScreenActionRule[],
): void {
  const meta = createEmptyTokenMeta();
  const screenActionRuleMap = toScreenActionRuleMap(parserVariant, screenActionRules);
  const lineIndentCache = new Map<number, number>();
  const lineTextCache = new Map<number, string>();
  const conditionalLogicalLineCache = new Map<number, string>();

  for (const token of tokens) {
    const type = token.type as number;
    if (!RELEVANT_TOKEN_TYPES.has(type)) {
      continue;
    }

    analyzeTokenMetaInto(token.metaTokens as Iterable<number>, meta);
    let tokenText: string | undefined;
    const val = (): string => {
      if (tokenText === undefined) {
        const raw = token.getValue(document);
        tokenText = type === PARSER_TOKENS.literalString ? normalizeLiteralString(raw) : raw;
      }
      return tokenText;
    };
    const menuDepth = meta.menuDepth;
    const lineIndent = getLineIndent(document, token.startPos.line, lineIndentCache);
    const lineText = getLineText(document, token.startPos.line, lineTextCache);
    const conditionalText = type === PARSER_TOKENS.kwConditional
      ? getConditionalLogicalLine(document, token.startPos.line, lineTextCache, conditionalLogicalLineCache)
      : lineText;

    maybeUpdateConditionalState(scanState, type, val, lineIndent, conditionalText);
    handleToken(state, scanState, {
      type,
      meta,
      val,
      chapter,
      menuDepth,
      lineIndent,
      lineText,
      captureDialogueLines,
      screenActionRuleMap,
    });
  }
}
