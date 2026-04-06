import type { TextDocument } from 'vscode-languageserver-textdocument';
import type { ParseGraphState, ParseScanState } from './pipelineTypes';
import { analyzeTokenMetaInto, createEmptyTokenMeta } from './tokenMeta';
import { maybeUpdateConditionalState } from './scanTransitions';
import { handleToken } from './tokenHandling';
import { PARSER_TOKENS } from '../parserTokens';

interface FlatTokenLike {
  type: number;
  metaTokens: Iterable<number>;
  startPos: { character: number };
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
