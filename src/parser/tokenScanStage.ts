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
  const menuToken = PARSER_TOKENS.kwMenuObserved;
  const labelToken = PARSER_TOKENS.kwLabel;
  const entityToken = PARSER_TOKENS.entityFunctionName;
  const jumpToken = PARSER_TOKENS.kwJump;
  const callToken = PARSER_TOKENS.kwCall;
  const returnToken = PARSER_TOKENS.kwReturn;
  const stringToken = PARSER_TOKENS.literalString;
  const conditionalToken = PARSER_TOKENS.kwConditional;

  for (const token of tokens) {
    const type = token.type as number;
    if (
      type !== menuToken &&
      type !== labelToken &&
      type !== entityToken &&
      type !== jumpToken &&
      type !== callToken &&
      type !== returnToken &&
      type !== stringToken &&
      type !== conditionalToken
    ) {
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
