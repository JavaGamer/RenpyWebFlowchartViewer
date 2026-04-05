import { Tokenizer } from '@renpy/ast/out/tokenizer/tokenizer';
import { TextDocument } from 'vscode-languageserver-textdocument';
import type { ParseGraphState } from './pipelineTypes';
import { analyzeTokenMeta } from './tokenMeta';
import { createScanState } from './pipelineState';
import { maybeUpdateConditionalState } from './scanTransitions';
import { handleToken } from './tokenHandling';

let _docVersion = 0;

async function renpyParse(content: string) {
  const document = TextDocument.create('file://my.rpy', 'rpy', ++_docVersion, content);
  return { document, nodes: await Tokenizer.tokenizeDocument(document) };
}

export async function parseOneFile(
  state: ParseGraphState,
  file: { name: string; content: string },
) {
  const chapter = file.name.replace(/\.rpy$/i, '');
  const { document, nodes: tokenTree } = await renpyParse(file.content);
  const flat = tokenTree.flatten();
  const scanState = createScanState();

  for (const tok of flat) {
    const type = tok.type as number;
    const meta = analyzeTokenMeta(tok.metaTokens as Iterable<number>);
    let tokenText: string | undefined;
    const val = (): string => {
      if (tokenText === undefined) tokenText = tok.getValue(document);
      return tokenText;
    };
    const menuDepth = meta.menuDepth;

    maybeUpdateConditionalState(scanState, type, val, tok.startPos.character);
    handleToken(state, scanState, { type, meta, val, chapter, menuDepth });
  }
}
