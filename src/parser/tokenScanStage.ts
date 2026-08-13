import type { TextDocument } from "vscode-languageserver-textdocument";
import type {
  TokenTree,
  TreeNode,
} from "@renpy/ast/out/tokenizer/token-definitions";
import type { AudioAssetCue, FlowNode } from "../domain/index.ts";
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
  extractShowAsset,
  extractStopCue,
  extractVoiceCue,
} from "./handlers/audioCues.ts";
import {
  type FlatTokenLike,
  getLineIndent,
  getLineText,
  getTokenSourceLocation,
} from "./tokenLocationUtils.ts";
import { getConditionalLogicalLine } from "./conditionalLineUtils.ts";

export type { FlatTokenLike };
export {
  computeLineIndent,
  fastOffsetAt,
  fastPositionAt,
  getLineIndent,
  getLineOffsets,
  getLineText,
  getTokenSourceLocation,
} from "./tokenLocationUtils.ts";
export { getConditionalLogicalLine } from "./conditionalLineUtils.ts";

/**
 * A set of token type identifiers that the parser is interested in tracking.
 * Other token types (like generic punctuation or comments) are ignored to optimize parsing.
 */
const RELEVANT_TOKEN_TYPES = new Set<number>([
  ...PARSER_TOKENS.menuKeywordTypes,
  PARSER_TOKENS.kwLabel,
  PARSER_TOKENS.kwScene,
  PARSER_TOKENS.kwShow,
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
      } else if (type === PARSER_TOKENS.kwShow) {
        const showAsset = extractShowAsset(lineText);
        if (showAsset) {
          audioAssetCues.push({
            type: "show",
            asset: showAsset,
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
