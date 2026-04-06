import { Tokenizer } from '@renpy/ast/out/tokenizer/tokenizer';
import type { TokenTree } from '@renpy/ast/out/tokenizer/token-definitions';
import { TextDocument } from 'vscode-languageserver-textdocument';
import type { ParseGraphState } from './pipelineTypes';
import { createScanState } from './pipelineState';
import { processFlatTokens } from './tokenScanStage';
import { createPerfTracker } from '../perf';

let _docVersion = 0;
const parserPerf = createPerfTracker('parser:file');

async function renpyParse(content: string) {
  const document = TextDocument.create('file://my.rpy', 'rpy', ++_docVersion, content);
  return { document, nodes: await Tokenizer.tokenizeDocument(document) };
}

export interface TokenizedFile {
  file: { name: string; content: string };
  chapter: string;
  document: TextDocument;
  tokenTree: TokenTree;
}

export async function tokenizeOneFile(file: { name: string; content: string }): Promise<TokenizedFile> {
  const chapter = file.name.replace(/\.rpy$/i, '');
  parserPerf.mark('tokenize');
  const { document, nodes: tokenTree } = await renpyParse(file.content);
  parserPerf.measure('tokenize', 'parse_tokenize_ms', { file: file.name });
  return { file, chapter, document, tokenTree };
}

export function processTokenizedFile(
  state: ParseGraphState,
  tokenizedFile: TokenizedFile,
) {
  const { file, chapter, document, tokenTree } = tokenizedFile;
  parserPerf.mark('flatten');
  const flat = tokenTree.flatten();
  parserPerf.measure('flatten', 'parse_flatten_ms', { file: file.name });

  parserPerf.mark('scan');
  const scanState = createScanState();
  processFlatTokens(state, scanState, flat, document, chapter);
  parserPerf.measure('scan', 'parse_scan_ms', { file: file.name });
}

export async function parseOneFile(
  state: ParseGraphState,
  file: { name: string; content: string },
) {
  const tokenized = await tokenizeOneFile(file);
  processTokenizedFile(state, tokenized);
}
