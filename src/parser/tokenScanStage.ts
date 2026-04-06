import type { TextDocument } from 'vscode-languageserver-textdocument';
import type { TokenTree, TreeNode } from '@renpy/ast/out/tokenizer/token-definitions';
import type { ParseGraphState, ParseScanState } from './pipelineTypes';
import { analyzeTokenMetaInto, createEmptyTokenMeta } from './tokenMeta';
import { maybeUpdateConditionalState } from './scanTransitions';
import { handleToken } from './tokenHandling';
import { PARSER_TOKENS } from '../parserTokens';

interface FlatTokenLike {
  type: number;
  metaTokens: Iterable<number>;
  startPos: { character: number };
  startOffset?: number;
  getValue: (document: TextDocument) => string;
}

const RELEVANT_TOKEN_TYPES = new Set<number>([
  PARSER_TOKENS.kwMenuObserved,
  PARSER_TOKENS.kwLabel,
  PARSER_TOKENS.entityFunctionName,
  PARSER_TOKENS.kwJump,
  PARSER_TOKENS.kwCall,
  PARSER_TOKENS.kwReturn,
  PARSER_TOKENS.literalString,
  PARSER_TOKENS.kwConditional,
]);

export function processFlatToken(
  state: ParseGraphState,
  scanState: ParseScanState,
  token: FlatTokenLike,
  document: TextDocument,
  chapter: string,
): void {
  const type = token.type as number;
  const meta = analyzeTokenMetaInto(token.metaTokens as Iterable<number>, createEmptyTokenMeta());
  let tokenText: string | undefined;
  const val = (): string => {
    if (tokenText === undefined) tokenText = token.getValue(document);
    return tokenText;
  };
  const menuDepth = meta.menuDepth;

  maybeUpdateConditionalState(scanState, type, val, token.startPos.character);
  handleToken(state, scanState, { type, meta, val, chapter, menuDepth });
}

function* iterateStreamTokens(
  node: TreeNode,
  inheritedMeta: number[],
): Generator<FlatTokenLike> {
  const token = node.token;
  const nextMeta = token ? [...inheritedMeta, token.type as number] : inheritedMeta;
  if (token && RELEVANT_TOKEN_TYPES.has(token.type as number)) {
    yield {
      type: token.type as number,
      metaTokens: inheritedMeta,
      startPos: token.startPos,
      startOffset: token.startPos.charStartOffset,
      getValue: token.getValue.bind(token),
    };
  }
  const children = [...node.children];
  children.sort((a, b) => {
    const aStart = a.token?.startPos.charStartOffset ?? Number.MAX_SAFE_INTEGER;
    const bStart = b.token?.startPos.charStartOffset ?? Number.MAX_SAFE_INTEGER;
    return aStart - bStart;
  });
  for (const child of children) {
    yield* iterateStreamTokens(child, nextMeta);
  }
}

function normalizeLiteralString(raw: string): string {
  if (raw.length >= 2) {
    const first = raw[0];
    const last = raw[raw.length - 1];
    if ((first === '"' && last === '"') || (first === '\'' && last === '\'')) {
      return raw.slice(1, -1);
    }
  }
  return raw;
}

export function processTokenTreeStream(
  state: ParseGraphState,
  scanState: ParseScanState,
  tokenTree: TokenTree,
  document: TextDocument,
  chapter: string,
): void {
  const meta = createEmptyTokenMeta();
  const tokens = [...iterateStreamTokens(tokenTree.root, [])];
  tokens.sort((a, b) => (a.startOffset ?? 0) - (b.startOffset ?? 0));
  for (const token of tokens) {
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
    maybeUpdateConditionalState(scanState, type, val, token.startPos.character);
    handleToken(state, scanState, { type, meta, val, chapter, menuDepth });
  }
}

export function processFlatTokens(
  state: ParseGraphState,
  scanState: ParseScanState,
  tokens: Iterable<FlatTokenLike>,
  document: TextDocument,
  chapter: string,
): void {
  const meta = createEmptyTokenMeta();

  for (const token of tokens) {
    const type = token.type as number;
    if (!RELEVANT_TOKEN_TYPES.has(type)) {
      continue;
    }

    analyzeTokenMetaInto(token.metaTokens as Iterable<number>, meta);
    let tokenText: string | undefined;
    const val = (): string => {
      if (tokenText === undefined) tokenText = token.getValue(document);
      return tokenText;
    };
    const menuDepth = meta.menuDepth;

    maybeUpdateConditionalState(scanState, type, val, token.startPos.character);
    handleToken(state, scanState, { type, meta, val, chapter, menuDepth });
  }
}
