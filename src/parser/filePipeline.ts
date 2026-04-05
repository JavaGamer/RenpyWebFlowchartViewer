import { Tokenizer } from '@renpy/ast/out/tokenizer/tokenizer';
import { TextDocument } from 'vscode-languageserver-textdocument';
import type { ParseGraphState } from './pipelineTypes';
import { createScanState } from './pipelineState';
import { processFlatTokens } from './tokenScanStage';

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
  processFlatTokens(state, scanState, flat, document, chapter);
}
