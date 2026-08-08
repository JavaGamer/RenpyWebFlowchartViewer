import type { TextDocument } from "vscode-languageserver-textdocument";
import type {
  TokenTree,
  TreeNode,
} from "@renpy/ast/out/tokenizer/token-definitions";
import type {
  AudioAssetCue,
  FlowNode,
  SourceLocation,
} from "../domain/index.ts";
import type { ParseGraphState, ParseScanState } from "./pipelineTypes.ts";
import { analyzeTokenMetaInto, createEmptyTokenMeta } from "./tokenMeta.ts";
import { maybeUpdateConditionalState } from "./scanTransitions.ts";
import { handleToken } from "./tokenHandling.ts";
import { PARSER_TOKENS } from "./parserTokens.ts";
import type { ParserVariant, ScreenActionRule } from "../config/parserRules.ts";
import {
  type ScreenActionKind,
  toScreenActionRuleMap,
} from "../config/parserRules.ts";
import type { NodeDetailsPayload } from "./workerProtocol.ts";
import {
  extractPlayCue,
  extractQueueCue,
  extractSceneAsset,
  extractStopCue,
  extractVoiceCue,
} from "./handlers/audioCues.ts";

/**
 * Represents a flattened token-like structure extracted from the AST tree.
 * Used during parsing to process token information uniformly.
 */
export interface FlatTokenLike {
  /** The type of token (corresponds to PARSER_TOKENS numbers) */
  type: number;
  /** Meta token IDs representing scope details (e.g. within menu, python, etc.) */
  metaTokens: Iterable<number>;
  /** Start position of the token in the text document */
  startPos: { line: number; character: number };
  /** Optional character offset of the token from the beginning of the file */
  startOffset?: number;
  /** End position of the token in the text document */
  endPos?: { line: number; character: number };
  /** End character offset of the token */
  endOffset?: number;
  /** Callback function to retrieve the raw string value of the token from the document */
  getValue: (document: TextDocument) => string;
}

const lineOffsetCache = new WeakMap<TextDocument, number[]>();

function getLineOffsets(document: TextDocument): number[] {
  let offsets = lineOffsetCache.get(document);
  if (!offsets) {
    offsets = [0];
    const text = document.getText();
    for (let i = 0; i < text.length; i++) {
      if (text.charCodeAt(i) === 10) {
        offsets.push(i + 1);
      }
    }
    lineOffsetCache.set(document, offsets);
  }
  return offsets;
}

function fastOffsetAt(
  document: TextDocument,
  pos: { line: number; character: number },
): number {
  const offsets = getLineOffsets(document);
  const lineStart = offsets[pos.line] ?? 0;
  return lineStart + pos.character;
}

function fastPositionAt(
  document: TextDocument,
  offset: number,
): { line: number; character: number } {
  const offsets = getLineOffsets(document);
  let low = 0;
  let high = offsets.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (offsets[mid] === offset) return { line: mid, character: 0 };
    if (offsets[mid] < offset) low = mid + 1;
    else high = mid - 1;
  }
  const line = Math.max(0, low - 1);
  return { line, character: offset - (offsets[line] ?? 0) };
}

export function getTokenSourceLocation(
  token: FlatTokenLike,
  document: TextDocument,
  file: string,
): SourceLocation {
  const startOffset = token.startOffset ??
    fastOffsetAt(document, token.startPos);
  const rawText = token.getValue(document);
  const endOffset = token.endOffset ?? (startOffset + rawText.length);
  const endPos = token.endPos ?? fastPositionAt(document, endOffset);
  return {
    file,
    start: {
      line: token.startPos.line,
      character: token.startPos.character,
      offset: startOffset,
    },
    end: {
      line: endPos.line,
      character: endPos.character,
      offset: endOffset,
    },
  };
}

/**
 * A set of token type identifiers that the parser is interested in tracking.
 * Other token types (like generic punctuation or comments) are ignored to optimize parsing.
 */
const RELEVANT_TOKEN_TYPES = new Set<number>([
  ...PARSER_TOKENS.menuKeywordTypes,
  PARSER_TOKENS.kwLabel,
  PARSER_TOKENS.kwScene,
  PARSER_TOKENS.entityFunctionName,
  PARSER_TOKENS.entityIdentifier,
  PARSER_TOKENS.kwJump,
  PARSER_TOKENS.kwExpression,
  PARSER_TOKENS.kwCall,
  PARSER_TOKENS.kwReturn,
  PARSER_TOKENS.literalString,
  PARSER_TOKENS.kwConditional,
  PARSER_TOKENS.metaPythonBlock,
  PARSER_TOKENS.metaScreenBlock,
  PARSER_TOKENS.kwPlay,
  PARSER_TOKENS.kwVoice,
  PARSER_TOKENS.kwStop,
  PARSER_TOKENS.kwQueue,
  PARSER_TOKENS.kwOther,
  PARSER_TOKENS.kwDollarSign,
  PARSER_TOKENS.kwScreen,
  PARSER_TOKENS.metaItemAccess,
  PARSER_TOKENS.metaFunctionCall,
  9999, // Allow processing unrecognized/invalid statement starts (e.g. timedchoice)
].filter((t): t is number => typeof t === "number"));

/**
 * Computes and caches the indent of a specific line in the TextDocument.
 * Indent is measured in terms of character length of leading space and tab characters.
 *
 * @param document The text document being parsed.
 * @param lineNumber The 0-indexed line number.
 * @param cache Map containing cached line indent results.
 * @returns The length of the leading whitespace characters on the line.
 */

/**
 * Computes the leading whitespace indentation level of a line string,
 * treating tab characters as 8-space (or tabStop) alignment boundaries.
 */
export function computeLineIndent(line: string, tabStop = 8): number {
  let indent = 0;
  for (let i = 0; i < line.length; i++) {
    const char = line.charCodeAt(i);
    if (char === 32) {
      indent += 1;
    } else if (char === 9) {
      indent += tabStop - (indent % tabStop);
    } else {
      break;
    }
  }
  return indent;
}

/**
 * Computes and caches the indent of a specific line in the TextDocument.
 * Indent is measured using tab-stop alignment (8 spaces per tab).
 *
 * @param document The text document being parsed.
 * @param lineNumber The 0-indexed line number.
 * @param cache Map containing cached line indent results.
 * @returns The leading whitespace column index on the line.
 */
function getLineIndent(
  document: TextDocument,
  lineNumber: number,
  cache: Map<number, number>,
  docLines?: readonly string[],
): number {
  const cached = cache.get(lineNumber);
  if (cached !== undefined) {
    return cached;
  }
  const line = docLines ? (docLines[lineNumber] ?? "") : document.getText({
    start: { line: lineNumber, character: 0 },
    end: { line: lineNumber, character: Number.MAX_SAFE_INTEGER },
  });
  const indent = computeLineIndent(line);
  cache.set(lineNumber, indent);
  return indent;
}

/**
 * Retrieves and caches the raw text content of a line in the TextDocument.
 *
 * @param document The text document being parsed.
 * @param lineNumber The 0-indexed line number.
 * @param cache Map containing cached line texts.
 * @returns The full string content of the line.
 */
function getLineText(
  document: TextDocument,
  lineNumber: number,
  cache: Map<number, string>,
  docLines?: readonly string[],
): string {
  const cached = cache.get(lineNumber);
  if (cached !== undefined) {
    return cached;
  }
  const line = docLines ? (docLines[lineNumber] ?? "") : document.getText({
    start: { line: lineNumber, character: 0 },
    end: { line: lineNumber, character: Number.MAX_SAFE_INTEGER },
  });
  cache.set(lineNumber, line);
  return line;
}

/**
 * Reconstructs a multiline logical python line for conditionals (if, elif, etc.).
 * Ren'Py/Python allow conditional expressions to span multiple lines using backslashes
 * or unclosed parenthesis/brackets/braces. This function tracks quotes, comments,
 * and brackets to join consecutive lines into a single logical expression.
 *
 * @param document The text document being parsed.
 * @param lineNumber The 0-indexed start line of the conditional.
 * @param lineTextCache A cache map of raw line content.
 * @param logicalLineCache A cache map of parsed logical lines.
 * @returns The complete multiline conditional statement text.
 */
function getConditionalLogicalLine(
  document: TextDocument,
  lineNumber: number,
  lineTextCache: Map<number, string>,
  logicalLineCache: Map<number, string>,
  docLines?: readonly string[],
): string {
  const cached = logicalLineCache.get(lineNumber);
  if (cached !== undefined) {
    return cached;
  }

  let logicalText = getLineText(document, lineNumber, lineTextCache, docLines);
  let currentLine = lineNumber;
  let maxLine = lineNumber;
  const delimiterStack: Array<")" | "]" | "}"> = [];
  let activeQuote: '"' | "'" | null = null;
  let tripleQuoted = false;
  let inComment = false;
  let explicitContinuation = false;

  // Process a line character by character to maintain quote/delimiter state
  const processLine = (lineText: string) => {
    let lastSignificantCharOutsideComment: string | null = null;
    for (let i = 0; i < lineText.length; i += 1) {
      const char = lineText[i] ?? "";
      if (inComment) {
        continue;
      }

      if (activeQuote) {
        if (char === "\\") {
          if (i + 1 < lineText.length) {
            i += 1; // Skip escaped character
          }
          continue;
        }
        if (tripleQuoted) {
          if (
            char === activeQuote && lineText[i + 1] === activeQuote &&
            lineText[i + 2] === activeQuote
          ) {
            i += 2;
            activeQuote = null;
            tripleQuoted = false;
          }
          continue;
        }
        if (char === activeQuote) {
          activeQuote = null;
        }
        continue;
      }

      if (char === "#") {
        inComment = true;
        continue;
      }
      if (
        (char === '"' || char === "'") && lineText[i + 1] === char &&
        lineText[i + 2] === char
      ) {
        activeQuote = char;
        tripleQuoted = true;
        i += 2;
        continue;
      }
      if (char === '"' || char === "'") {
        activeQuote = char;
        tripleQuoted = false;
        continue;
      }

      if (char === "(") {
        delimiterStack.push(")");
      } else if (char === "[") {
        delimiterStack.push("]");
      } else if (char === "{") {
        delimiterStack.push("}");
      } else if (char === ")" || char === "]" || char === "}") {
        if (char === delimiterStack[delimiterStack.length - 1]) {
          delimiterStack.pop();
        }
      }

      if (
        !(char === " " || char === "\t" || char === "\n" || char === "\r" ||
          char === "\f" || char === "\v")
      ) {
        lastSignificantCharOutsideComment = char;
      }
    }
    // Check if the line ends with an explicit backslash continuation character
    explicitContinuation = lastSignificantCharOutsideComment === "\\";
    inComment = false;
  };

  processLine(logicalText);
  // Continue joining lines while inside unclosed parentheses/quotes or explicit continuation
  while (
    (explicitContinuation || delimiterStack.length > 0 ||
      activeQuote !== null) &&
    currentLine + 1 < document.lineCount
  ) {
    currentLine += 1;
    const nextLine = getLineText(
      document,
      currentLine,
      lineTextCache,
      docLines,
    );
    logicalText += `\n${nextLine}`;
    processLine(nextLine);
    maxLine = currentLine;
  }

  // Populate logical line cache for all lines spanned by this logical statement
  for (let i = lineNumber; i <= maxLine; i += 1) {
    logicalLineCache.set(i, logicalText);
  }
  return logicalText;
}

/**
 * Pre-processes and dispatches a single flat token to token handling logic.
 * Also monitors and handles transition states like block levels and conditionals.
 */
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
  sceneSplitDialogueThreshold?: number,
  docLines?: readonly string[],
): void {
  const type = token.type as number;
  const meta = analyzeTokenMetaInto(
    token.metaTokens as Iterable<number>,
    createEmptyTokenMeta(),
  );
  const screenActionRuleMap = precomputedScreenActionRuleMap ??
    toScreenActionRuleMap(parserVariant, screenActionRules);
  let tokenText: string | undefined;
  const val = (): string => {
    if (tokenText === undefined) {
      const raw = token.getValue(document);
      tokenText = type === PARSER_TOKENS.literalString
        ? normalizeLiteralString(raw)
        : raw;
    }
    return tokenText;
  };
  const menuDepth = meta.menuDepth;
  const lineIndent = getLineIndent(
    document,
    token.startPos.line,
    lineIndentCache,
    docLines,
  );
  const lineText = getLineText(
    document,
    token.startPos.line,
    lineTextCache,
    docLines,
  );
  const conditionalText = type === PARSER_TOKENS.kwConditional
    ? getConditionalLogicalLine(
      document,
      token.startPos.line,
      lineTextCache,
      conditionalLogicalLineCache,
      docLines,
    )
    : lineText;

  const sourceLocation = getTokenSourceLocation(token, document, chapter);

  maybeUpdateConditionalState(
    scanState,
    type,
    val,
    lineIndent,
    conditionalText,
    token.startPos.line,
    sourceLocation,
  );

  handleToken(state, scanState, {
    type,
    meta,
    val,
    chapter,
    menuDepth,
    lineIndent,
    lineText,
    lineNum: token.startPos.line,
    captureDialogueLines,
    screenActionRuleMap,
    sceneSplitDialogueThreshold,
    sourceLocation,
  });
}

/**
 * Normalizes literal python/renpy string quotes (single, double, or triple) by
 * stripping prefix modifiers and surrounding quote markers.
 */
function normalizeLiteralString(raw: string): string {
  let start = 0;
  const len = raw.length;
  while (start < len) {
    const char = raw[start];
    if (char === '"' || char === "'") {
      break;
    }
    start++;
  }

  if (start >= len) return raw;

  const quoteChar = raw[start]!;
  // Detect triple-quote
  const isTriple = start + 2 < len && raw[start + 1] === quoteChar &&
    raw[start + 2] === quoteChar;
  const quoteLen = isTriple ? 3 : 1;
  const contentStart = start + quoteLen;
  const expectedEnd = isTriple ? quoteChar + quoteChar + quoteChar : quoteChar;

  if (!raw.endsWith(expectedEnd) || len - quoteLen < contentStart) {
    return raw;
  }

  return raw.slice(contentStart, len - quoteLen);
}

/**
 * Traverses a hierarchical AST TokenTree, flattens, sorts, and processes
 * all tokens sequentially to build the flowchart graph state.
 *
 * @param state The global multi-file parser graph assembler.
 * @param scanState The file-local state tracks scope, indentations, and block hierarchies.
 * @param tokenTree The raw AST token tree parsed from a single Ren'Py script file.
 * @param document VS Code languageserver document wrapper of the script file.
 * @param chapter Inferred chapter/filename string for grouping and naming labels.
 * @param captureDialogueLines Whether to index dialogue strings in node data.
 * @param parserVariant Parser rules presets ('renpy' or 'st').
 * @param screenActionRules Optional user custom rules mappings for screen actions.
 * @param sceneSplitDialogueThreshold Dialogue line threshold for automatic scene divisions.
 */
function collectFlatTokens(
  node: TreeNode,
  metaStack: number[],
  tokens: Array<FlatTokenLike>,
  doc?: TextDocument,
): void {
  const token = node.token;
  if (token) {
    const type = token.type as number;
    if (RELEVANT_TOKEN_TYPES.has(type)) {
      const rawText = doc ? token.getValue(doc) : "";
      const startOffset = (token as { startOffset?: number }).startOffset ??
        (doc ? doc.offsetAt(token.startPos) : 0);
      const endOffset = startOffset + rawText.length;
      const endPos = doc ? doc.positionAt(endOffset) : token.startPos;
      tokens.push({
        type,
        metaTokens: [...metaStack],
        startPos: token.startPos,
        startOffset,
        endPos,
        endOffset,
        getValue: (document) => token.getValue(document),
      });
    }
    metaStack.push(type);
  }
  node.children.forEach((child) =>
    collectFlatTokens(child, metaStack, tokens, doc)
  );
  if (token) {
    metaStack.pop();
  }
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
  sceneSplitDialogueThreshold?: number,
  deferDetails?: boolean,
): void {
  const tokens: FlatTokenLike[] = [];

  collectFlatTokens(tokenTree.root, [], tokens, document);

  tokens.sort((a, b) => {
    if (a.startPos.line !== b.startPos.line) {
      return a.startPos.line - b.startPos.line;
    }
    return a.startPos.character - b.startPos.character;
  });

  processFlatTokens(
    state,
    scanState,
    tokens,
    document,
    chapter,
    captureDialogueLines,
    parserVariant,
    screenActionRules,
    sceneSplitDialogueThreshold,
    deferDetails,
  );
}

/**
 * Processes a sequence of already flattened tokens sequentially.
 * Useful when working with flattened/pre-processed token logs or arrays.
 */
export function processFlatTokens(
  state: ParseGraphState,
  scanState: ParseScanState,
  tokens: Iterable<FlatTokenLike>,
  document: TextDocument,
  chapter: string,
  captureDialogueLines: boolean,
  parserVariant?: ParserVariant,
  screenActionRules?: ScreenActionRule[],
  sceneSplitDialogueThreshold?: number,
  deferDetails?: boolean,
): void {
  const meta = createEmptyTokenMeta();
  const screenActionRuleMap = toScreenActionRuleMap(
    parserVariant,
    screenActionRules,
  );
  const lineIndentCache = new Map<number, number>();
  const lineTextCache = new Map<number, string>();
  const conditionalLogicalLineCache = new Map<number, string>();

  const docLines = document.getText().split(/\r?\n/);

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
        tokenText = type === PARSER_TOKENS.literalString
          ? normalizeLiteralString(raw)
          : raw;
      }
      return tokenText;
    };
    const menuDepth = meta.menuDepth;
    const lineIndent = getLineIndent(
      document,
      token.startPos.line,
      lineIndentCache,
      docLines,
    );
    const lineText = getLineText(
      document,
      token.startPos.line,
      lineTextCache,
      docLines,
    );
    const conditionalText = type === PARSER_TOKENS.kwConditional
      ? getConditionalLogicalLine(
        document,
        token.startPos.line,
        lineTextCache,
        conditionalLogicalLineCache,
        docLines,
      )
      : lineText;

    const sourceLocation = getTokenSourceLocation(token, document, chapter);

    maybeUpdateConditionalState(
      scanState,
      type,
      val,
      lineIndent,
      conditionalText,
      token.startPos.line,
      sourceLocation,
    );

    handleToken(state, scanState, {
      type,
      meta,
      val,
      chapter,
      menuDepth,
      lineIndent,
      lineText,
      lineNum: token.startPos.line,
      captureDialogueLines,
      deferDetails,
      screenActionRuleMap,
      sceneSplitDialogueThreshold,
      sourceLocation,
    });
  }
}

export function extractNodeDetailsFromTokens(
  nodes: FlowNode[],
  tokenizedFilesByChapter: Map<
    string,
    { document: TextDocument; tokenTree: TokenTree }
  >,
): Record<string, NodeDetailsPayload> {
  const result: Record<string, NodeDetailsPayload> = {};

  const cachedTokensByTokenized = new Map<
    unknown,
    { flatTokens: FlatTokenLike[]; docLines: string[] }
  >();

  for (const node of nodes) {
    if (!node.sourceLocation) continue;
    const chapter = node.chapter || "";
    const tokenized = tokenizedFilesByChapter.get(chapter) ||
      (!chapter && tokenizedFilesByChapter.size > 0
        ? tokenizedFilesByChapter.values().next().value
        : undefined);
    if (!tokenized) continue;

    const { document, tokenTree } = tokenized;
    const startLine = node.sourceLocation.start.line;
    const endLine = node.sourceLocation.end.line;

    const dialogueLines: string[] = [];
    const dialogueLineNums: number[] = [];
    const audioAssetCues: AudioAssetCue[] = [];

    let cached = cachedTokensByTokenized.get(tokenized);
    if (!cached) {
      const flatTokens: FlatTokenLike[] = [];
      collectFlatTokens(tokenTree.root, [], flatTokens, document);
      flatTokens.sort((a, b) => {
        if (a.startPos.line !== b.startPos.line) {
          return a.startPos.line - b.startPos.line;
        }
        return a.startPos.character - b.startPos.character;
      });
      const docLines = document.getText().split(/\r?\n/);
      cached = { flatTokens, docLines };
      cachedTokensByTokenized.set(tokenized, cached);
    }
    const { flatTokens, docLines } = cached;
    const lineTextCache = new Map<number, string>();

    for (const token of flatTokens) {
      const lineNum = token.startPos.line;
      if (lineNum < startLine || lineNum > endLine) continue;
      const type = token.type as number;
      if (!RELEVANT_TOKEN_TYPES.has(type)) continue;

      const lineText = getLineText(document, lineNum, lineTextCache, docLines);
      const rawVal = token.getValue(document);
      const valStr = type === PARSER_TOKENS.literalString
        ? normalizeLiteralString(rawVal)
        : rawVal;

      if (type === PARSER_TOKENS.literalString) {
        const meta = createEmptyTokenMeta();
        if (token.metaTokens) {
          analyzeTokenMetaInto(token.metaTokens, meta);
        }
        const isSay = (meta.hasSayNarrator || meta.hasSayCharacter ||
          meta.hasSayStatement) && !meta.hasMenuOption;
        const isInMenu = meta.hasMenuBlock || meta.hasMenuOptionBlock ||
          meta.menuDepth > 0;

        const isTarget = isSay && (node.type === "MENU" ? isInMenu : !isInMenu);

        if (isTarget) {
          const trimmed = lineText.trim();
          const isCustomStatement = /^(gameover|title|timedchoice)\b/i.test(
            trimmed,
          );
          const isAudioOrSceneCue =
            /^(play|queue|sound|music|voice|scene|stop)\b/i.test(trimmed);
          if (!isCustomStatement && !isAudioOrSceneCue) {
            dialogueLines.push(valStr);
            dialogueLineNums.push(lineNum);
          }
        }
      } else if (type === PARSER_TOKENS.kwScene) {
        const sceneAsset = extractSceneAsset(lineText);
        if (sceneAsset) {
          audioAssetCues.push({
            type: "scene",
            asset: sceneAsset,
            raw: lineText.trim(),
            lineNum,
            sourceLocation: getTokenSourceLocation(token, document, chapter),
          });
        }
      } else if (type === PARSER_TOKENS.kwPlay) {
        const cue = extractPlayCue(lineText);
        if (cue) {
          audioAssetCues.push({
            type: "play",
            channel: cue.channel,
            asset: cue.asset,
            raw: lineText.trim(),
            lineNum,
            sourceLocation: getTokenSourceLocation(token, document, chapter),
          });
        }
      } else if (type === PARSER_TOKENS.kwStop) {
        const cue = extractStopCue(lineText);
        if (cue) {
          audioAssetCues.push({
            type: "stop",
            channel: cue.channel,
            asset: cue.asset ?? "",
            raw: lineText.trim(),
            lineNum,
            sourceLocation: getTokenSourceLocation(token, document, chapter),
          });
        }
      } else if (type === PARSER_TOKENS.kwQueue) {
        const cue = extractQueueCue(lineText);
        if (cue) {
          audioAssetCues.push({
            type: "queue",
            channel: cue.channel,
            asset: cue.asset,
            raw: lineText.trim(),
            lineNum,
            sourceLocation: getTokenSourceLocation(token, document, chapter),
          });
        }
      } else if (
        type === PARSER_TOKENS.kwVoice ||
        (type === PARSER_TOKENS.kwOther &&
          valStr.trim().toLowerCase() === "voice")
      ) {
        const voiceAsset = extractVoiceCue(lineText);
        if (voiceAsset) {
          audioAssetCues.push({
            type: "voice",
            asset: voiceAsset,
            raw: lineText.trim(),
            lineNum,
            sourceLocation: getTokenSourceLocation(token, document, chapter),
          });
        }
      }
    }

    result[node.id] = {
      nodeId: node.id,
      dialogueLines: dialogueLines.length > 0 ? dialogueLines : undefined,
      dialogueLineNums: dialogueLineNums.length > 0
        ? dialogueLineNums
        : undefined,
      audioAssetCues: audioAssetCues.length > 0 ? audioAssetCues : undefined,
    };
  }

  return result;
}
