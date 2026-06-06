import type { TextDocument } from 'vscode-languageserver-textdocument';
import type { TokenTree, TreeNode } from '@renpy/ast/out/tokenizer/token-definitions';
import type { ParseGraphState, ParseScanState } from './pipelineTypes';
import { analyzeTokenMetaInto, createEmptyTokenMeta } from './tokenMeta';
import { maybeUpdateConditionalState } from './scanTransitions';
import { handleToken } from './tokenHandling';
import { PARSER_TOKENS } from './parserTokens';
import type { ParserVariant, ScreenActionRule } from '../config/parserRules';
import { toScreenActionRuleMap, type ScreenActionKind } from '../config/parserRules';

/**
 * Represents a flattened token-like structure extracted from the AST tree.
 * Used during parsing to process token information uniformly.
 */
interface FlatTokenLike {
  /** The type of token (corresponds to PARSER_TOKENS numbers) */
  type: number;
  /** Meta token IDs representing scope details (e.g. within menu, python, etc.) */
  metaTokens: Iterable<number>;
  /** Start position of the token in the text document */
  startPos: { line: number; character: number };
  /** Optional character offset of the token from the beginning of the file */
  startOffset?: number;
  /** Callback function to retrieve the raw string value of the token from the document */
  getValue: (document: TextDocument) => string;
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
  PARSER_TOKENS.metaItemAccess,
  PARSER_TOKENS.metaFunctionCall,
].filter((t): t is number => typeof t === 'number'));

/**
 * Computes and caches the indent of a specific line in the TextDocument.
 * Indent is measured in terms of character length of leading space and tab characters.
 *
 * @param document The text document being parsed.
 * @param lineNumber The 0-indexed line number.
 * @param cache Map containing cached line indent results.
 * @returns The length of the leading whitespace characters on the line.
 */
function getLineIndent(
  document: TextDocument,
  lineNumber: number,
  cache: Map<number, number>,
): number {
  const cached = cache.get(lineNumber);
  if (cached !== undefined) {
    return cached;
  }
  const line = document.getText({
    start: { line: lineNumber, character: 0 },
    end: { line: lineNumber, character: Number.MAX_SAFE_INTEGER },
  });
  const match = line.match(/^[ \t]*/);
  const indent = match?.[0]?.length ?? 0;
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
): string {
  const cached = cache.get(lineNumber);
  if (cached !== undefined) {
    return cached;
  }
  const line = document.getText({
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
): string {
  const cached = logicalLineCache.get(lineNumber);
  if (cached !== undefined) {
    return cached;
  }

  let logicalText = getLineText(document, lineNumber, lineTextCache);
  let currentLine = lineNumber;
  let maxLine = lineNumber;
  const delimiterStack: Array<')' | ']' | '}'> = [];
  let activeQuote: '"' | '\'' | null = null;
  let tripleQuoted = false;
  let inComment = false;
  let explicitContinuation = false;

  // Process a line character by character to maintain quote/delimiter state
  const processLine = (lineText: string) => {
    let lastSignificantCharOutsideComment: string | null = null;
    for (let i = 0; i < lineText.length; i += 1) {
      const char = lineText[i] ?? '';
      if (inComment) {
        continue;
      }

      if (activeQuote) {
        if (char === '\\') {
          if (i + 1 < lineText.length) {
            i += 1; // Skip escaped character
          }
          continue;
        }
        if (tripleQuoted) {
          if (char === activeQuote && lineText[i + 1] === activeQuote && lineText[i + 2] === activeQuote) {
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

      if (char === '#') {
        inComment = true;
        continue;
      }
      if ((char === '"' || char === '\'') && lineText[i + 1] === char && lineText[i + 2] === char) {
        activeQuote = char;
        tripleQuoted = true;
        i += 2;
        continue;
      }
      if (char === '"' || char === '\'') {
        activeQuote = char;
        tripleQuoted = false;
        continue;
      }

      if (char === '(') {
        delimiterStack.push(')');
      } else if (char === '[') {
        delimiterStack.push(']');
      } else if (char === '{') {
        delimiterStack.push('}');
      } else if (char === ')' || char === ']' || char === '}') {
        if (char === delimiterStack[delimiterStack.length - 1]) {
          delimiterStack.pop();
        }
      }

      if (!/\s/.test(char)) {
        lastSignificantCharOutsideComment = char;
      }
    }
    // Check if the line ends with an explicit backslash continuation character
    explicitContinuation = lastSignificantCharOutsideComment === '\\';
    inComment = false;
  };

  processLine(logicalText);
  // Continue joining lines while inside unclosed parentheses/quotes or explicit continuation
  while ((explicitContinuation || delimiterStack.length > 0) && currentLine + 1 < document.lineCount) {
    currentLine += 1;
    const nextLine = getLineText(document, currentLine, lineTextCache);
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
): void {
  const type = token.type as number;
  const meta = analyzeTokenMetaInto(token.metaTokens as Iterable<number>, createEmptyTokenMeta());
  const screenActionRuleMap = precomputedScreenActionRuleMap ?? toScreenActionRuleMap(parserVariant, screenActionRules);
  let tokenText: string | undefined;
  const val = (): string => {
    if (tokenText === undefined) {
      const raw = token.getValue(document);
      tokenText = type === PARSER_TOKENS.literalString ? normalizeLiteralString(raw) : raw;
    }
    return tokenText;
  };
  const menuDepth = meta.menuDepth;
  const lineIndent = getLineIndent(document, token.startPos.line, lineIndentCache);
  const lineText = getLineText(document, token.startPos.line, lineTextCache);
  const conditionalText = type === PARSER_TOKENS.kwConditional
    ? getConditionalLogicalLine(document, token.startPos.line, lineTextCache, conditionalLogicalLineCache)
    : lineText;

  maybeUpdateConditionalState(scanState, type, val, lineIndent, conditionalText);
  handleToken(state, scanState, {
    type,
    meta,
    val,
    chapter,
    menuDepth,
    lineIndent,
    lineText,
    captureDialogueLines,
    screenActionRuleMap,
    sceneSplitDialogueThreshold,
  });
}

/**
 * Visitor function that traverses the hierarchical tokenizer TreeNode structure
 * in pre-order (respecting the character offset positions) to find and emit flat tokens.
 */
function traverseStreamTokens(
  node: TreeNode,
  metaStack: number[],
  onToken: (token: FlatTokenLike) => void,
): void {
  const token = node.token;

  // Emit current node's token first if it is relevant to the parser
  if (token && RELEVANT_TOKEN_TYPES.has(token.type as number)) {
    onToken({
      type: token.type as number,
      metaTokens: metaStack,
      startPos: token.startPos,
      startOffset: token.startPos.charStartOffset,
      getValue: token.getValue.bind(token),
    });
  }

  // Push current token type to metaStack before recursing children
  if (token) {
    metaStack.push(token.type as number);
  }

  // Children are already in chronological order, process them sequentially
  for (const child of node.children) {
    traverseStreamTokens(child, metaStack, onToken);
  }

  // Pop token type from stack on exit
  if (token) {
    metaStack.pop();
  }
}

/**
 * Normalizes literal python/renpy string quotes (single, double, or triple) by
 * stripping prefix modifiers and surrounding quote markers.
 */
function normalizeLiteralString(raw: string): string {
  const match = /^(?:[rR]|[uU]|[bB]|[fF]|[rR][bB]|[bB][rR]|[rR][fF]|[fF][rR]|[rR][uU]|[uU][rR])?(?:("""|'''|"|')([\s\S]*?)\1)$/.exec(raw);
  if (match) {
    return match[2] ?? '';
  }
  return raw;
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
): void {
  const meta = createEmptyTokenMeta();
  const screenActionRuleMap = toScreenActionRuleMap(parserVariant, screenActionRules);
  const lineIndentCache = new Map<number, number>();
  const lineTextCache = new Map<number, string>();
  const conditionalLogicalLineCache = new Map<number, string>();

  traverseStreamTokens(tokenTree.root, [], (token) => {
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
    const lineIndent = getLineIndent(document, token.startPos.line, lineIndentCache);
    const lineText = getLineText(document, token.startPos.line, lineTextCache);
    const conditionalText = type === PARSER_TOKENS.kwConditional
      ? getConditionalLogicalLine(document, token.startPos.line, lineTextCache, conditionalLogicalLineCache)
      : lineText;
    maybeUpdateConditionalState(scanState, type, val, lineIndent, conditionalText);
    handleToken(state, scanState, {
      type,
      meta,
      val,
      chapter,
      menuDepth,
      lineIndent,
      lineText,
      captureDialogueLines,
      screenActionRuleMap,
      sceneSplitDialogueThreshold,
    });
  });
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
): void {
  const meta = createEmptyTokenMeta();
  const screenActionRuleMap = toScreenActionRuleMap(parserVariant, screenActionRules);
  const lineIndentCache = new Map<number, number>();
  const lineTextCache = new Map<number, string>();
  const conditionalLogicalLineCache = new Map<number, string>();

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
        tokenText = type === PARSER_TOKENS.literalString ? normalizeLiteralString(raw) : raw;
      }
      return tokenText;
    };
    const menuDepth = meta.menuDepth;
    const lineIndent = getLineIndent(document, token.startPos.line, lineIndentCache);
    const lineText = getLineText(document, token.startPos.line, lineTextCache);
    const conditionalText = type === PARSER_TOKENS.kwConditional
      ? getConditionalLogicalLine(document, token.startPos.line, lineTextCache, conditionalLogicalLineCache)
      : lineText;

    maybeUpdateConditionalState(scanState, type, val, lineIndent, conditionalText);
    handleToken(state, scanState, {
      type,
      meta,
      val,
      chapter,
      menuDepth,
      lineIndent,
      lineText,
      captureDialogueLines,
      screenActionRuleMap,
      sceneSplitDialogueThreshold,
    });
  }
}

