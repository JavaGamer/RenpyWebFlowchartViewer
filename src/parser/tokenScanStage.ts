import type { TextDocument } from 'vscode-languageserver-textdocument';
import type { TokenTree, TreeNode } from '@renpy/ast/out/tokenizer/token-definitions';
import type { ParseGraphState, ParseScanState } from './pipelineTypes';
import { analyzeTokenMetaInto, createEmptyTokenMeta } from './tokenMeta';
import { maybeUpdateConditionalState } from './scanTransitions';
import { handleToken } from './tokenHandling';
import { PARSER_TOKENS } from '../parserTokens';
import type { ParserVariant, ScreenActionRule } from '../config/parserRules';
import { toScreenActionRuleMap } from '../config/parserRules';

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
  PARSER_TOKENS.metaPythonBlock,
  PARSER_TOKENS.metaScreenBlock,
].filter((t): t is number => typeof t === 'number'));

export function processFlatToken(
  state: ParseGraphState,
  scanState: ParseScanState,
  token: FlatTokenLike,
  document: TextDocument,
  chapter: string,
  captureDialogueLines: boolean,
  parserVariant: ParserVariant | undefined = 'renpy',
  screenActionRules: ScreenActionRule[] | undefined = [],
): void {
  const type = token.type as number;
  const meta = analyzeTokenMetaInto(token.metaTokens as Iterable<number>, createEmptyTokenMeta());
  const screenActionRuleMap = toScreenActionRuleMap(parserVariant, screenActionRules);
  let tokenText: string | undefined;
  const val = (): string => {
    if (tokenText === undefined) tokenText = token.getValue(document);
    return tokenText;
  };
  const menuDepth = meta.menuDepth;

  maybeUpdateConditionalState(scanState, type, val, token.startPos.character);
  handleToken(state, scanState, {
    type,
    meta,
    val,
    chapter,
    menuDepth,
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
  captureDialogueLines = true,
  parserVariant: ParserVariant | undefined = 'renpy',
  screenActionRules: ScreenActionRule[] | undefined = [],
): void {
  const meta = createEmptyTokenMeta();
  const screenActionRuleMap = toScreenActionRuleMap(parserVariant, screenActionRules);
  const startOffsetCache = new WeakMap<TreeNode, number>();
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
    maybeUpdateConditionalState(scanState, type, val, token.startPos.character);
    handleToken(state, scanState, {
      type,
      meta,
      val,
      chapter,
      menuDepth,
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
  parserVariant: ParserVariant | undefined = 'renpy',
  screenActionRules: ScreenActionRule[] | undefined = [],
): void {
  const meta = createEmptyTokenMeta();
  const screenActionRuleMap = toScreenActionRuleMap(parserVariant, screenActionRules);

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
    handleToken(state, scanState, {
      type,
      meta,
      val,
      chapter,
      menuDepth,
      captureDialogueLines,
      screenActionRuleMap,
    });
  }
}
