import type { TextDocument } from 'vscode-languageserver-textdocument';
import type { ParseGraphState, ParseScanState } from './pipelineTypes';
import { analyzeTokenMeta } from './tokenMeta';
import { maybeUpdateConditionalState } from './scanTransitions';
import { handleToken } from './tokenHandling';

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
  const meta = analyzeTokenMeta(token.metaTokens as Iterable<number>);
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
  for (const token of tokens) {
    processFlatToken(state, scanState, token, document, chapter);
  }
}
