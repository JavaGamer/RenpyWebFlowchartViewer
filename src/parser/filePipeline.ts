import { Tokenizer } from '@renpy/ast/out/tokenizer/tokenizer';
import type { TokenTree } from '@renpy/ast/out/tokenizer/token-definitions';
import { TextDocument } from 'vscode-languageserver-textdocument';
import type { ParseGraphState } from './pipelineTypes';
import { createScanState } from './pipelineState';
import { processTokenTreeStream } from './tokenScanStage';
import type { ParseInputFile, ParseOptions } from './pipelineTypes';

let _docVersion = 0;
let parserPerf: any = null;

async function initParserPerf() {
  if (!parserPerf) {
    const infra = await import('../infrastructure');
    parserPerf = infra.createPerfTracker('parser:file');
  }
}

async function renpyParse(content: string) {
  const document = TextDocument.create('file://my.rpy', 'rpy', ++_docVersion, content);
  return { document, nodes: await Tokenizer.tokenizeDocument(document) };
}

export interface TokenizedFile {
  file: ParseInputFile;
  chapter: string;
  document: TextDocument;
  tokenTree: TokenTree;
  cacheKey?: string;
}

type ParseFileOptions = Pick<
  ParseOptions,
  'tokenizedCache' | 'fileCacheKeys' | 'captureDialogueLines' | 'parserVariant' | 'screenActionRules' | 'sceneSplitDialogueThreshold'
>;

export async function tokenizeOneFile(
  file: ParseInputFile,
  options: Pick<ParseFileOptions, 'tokenizedCache' | 'fileCacheKeys'> = {},
  fileIndex?: number,
): Promise<TokenizedFile> {
  const { tokenizedCache } = options;
  const chapterSource = file.relativePath ?? file.name;
  const chapter = chapterSource.replace(/\\/g, '/').replace(/\.rpy$/i, '');
  const cacheKey =
    fileIndex !== undefined && options.fileCacheKeys?.[fileIndex]
      ? options.fileCacheKeys[fileIndex]
      : undefined;

  if (cacheKey && tokenizedCache) {
    const cached = tokenizedCache.get(cacheKey);
    if (cached) {
      return { file, chapter, document: cached.document, tokenTree: cached.tokenTree, cacheKey };
    }
  }

  const tokenizeMark = `tokenize:${cacheKey ?? file.name}:${fileIndex ?? -1}`;
  await initParserPerf();
  parserPerf.mark(tokenizeMark);
  const { document, nodes: tokenTree } = await renpyParse(file.content);
  parserPerf.measure(tokenizeMark, 'parse_tokenize_ms', { file: file.name });
  if (cacheKey && tokenizedCache) {
    tokenizedCache.set(cacheKey, { document, tokenTree });
  }
  return { file, chapter, document, tokenTree, cacheKey };
}

export function processTokenizedFile(
  state: ParseGraphState,
  tokenizedFile: TokenizedFile,
  options: Pick<ParseFileOptions, 'captureDialogueLines' | 'parserVariant' | 'screenActionRules' | 'sceneSplitDialogueThreshold'> = {},
) {
  const { file, chapter, document, tokenTree } = tokenizedFile;
  parserPerf.mark('scan');
  const scanState = createScanState();
  processTokenTreeStream(
    state,
    scanState,
    tokenTree,
    document,
    chapter,
    options.captureDialogueLines !== false,
    options.parserVariant,
    options.screenActionRules,
    options.sceneSplitDialogueThreshold,
  );
  parserPerf.measure('scan', 'parse_scan_ms', { file: file.name });
}

export async function parseOneFile(
  state: ParseGraphState,
  file: ParseInputFile,
  options: ParseFileOptions = {},
  fileIndex?: number,
) {
  const tokenized = await tokenizeOneFile(file, options, fileIndex);
  processTokenizedFile(state, tokenized, options);
}
