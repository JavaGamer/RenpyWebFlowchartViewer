import type {
  ExtractedScreenActionExpression,
  ParseGraphState,
  ParseScanState,
  TokenMetaFlags,
} from "../pipelineTypes.ts";
import type { ScreenActionKind } from "../../config/parserRules.ts";
import type { FlowEdge } from "../../domain/index.ts";
import { isMenuKeywordTokenType, PARSER_TOKENS } from "../parserTokens.ts";
import {
  addDynamicTargetDiagnostic,
  emitCallEdge,
  emitJumpEdge,
  parseDictLiteral,
  parseListLiteral,
  resolveCallContext,
  resolveExpressionTargets,
  resolveStaticTargetExpression,
} from "./jumpCallHandler.ts";

const PYTHON_RENPY_CALL_START_PATTERN = /\brenpy\.(jump|call)\s*\(/g;
const RECURSIVE_SCREEN_ACTION_WRAPPER_NAMES = new Set([
  "if",
  "selectedif",
  "sensitiveif",
  "showif",
]);

type OpeningDelimiter = "(" | "[" | "{";
type ClosingDelimiter = ")" | "]" | "}";
const CLOSING_DELIMITER_BY_OPENING: Record<OpeningDelimiter, ClosingDelimiter> =
  {
    "(": ")",
    "[": "]",
    "{": "}",
  };
const CLOSING_DELIMITERS = new Set<ClosingDelimiter>([")", "]", "}"]);

// Captures simple assignment statements in Python blocks:
//   1) LHS variable identifier
//   2) optional type annotation (`name: str = ...`)
//   3) single `=` assignment (not `==`)
//   4) RHS expression text up to line end
const PYTHON_ASSIGNMENT_PATTERN_SOURCE =
  "^[ \\t]*([A-Za-z_][A-Za-z0-9_]*)(?:[ \\t]*:[^=\\n#]+)?[ \\t]*=(?!=)([^\\n]*)$";

function isIdentifierStart(char: string | undefined): boolean {
  if (!char) return false;
  const code = char.charCodeAt(0);
  return (
    (code >= 65 && code <= 90) || // A-Z
    (code >= 97 && code <= 122) || // a-z
    code === 95 // _
  );
}

function isIdentifierPart(char: string | undefined): boolean {
  if (!char) return false;
  const code = char.charCodeAt(0);
  return (
    (code >= 65 && code <= 90) || // A-Z
    (code >= 97 && code <= 122) || // a-z
    (code >= 48 && code <= 57) || // 0-9
    code === 95 || // _
    code === 46 // .
  );
}

function isWhitespaceChar(char: string | undefined): boolean {
  return char === " " || char === "\t" || char === "\n" || char === "\r" ||
    char === "\f";
}

function isTopLevelPythonStatementMatch(
  text: string,
  matchIndex: number,
): boolean {
  let parenDepth = 0;
  let bracketDepth = 0;
  let braceDepth = 0;
  let activeQuote: '"' | "'" | null = null;
  let tripleQuoted = false;
  let index = 0;

  while (index < matchIndex) {
    const char = text[index];
    if (activeQuote) {
      if (char === "\\") {
        const escapeSequenceLength = (index + 1 < text.length) ? 2 : 1;
        index += escapeSequenceLength;
        continue;
      }
      if (tripleQuoted) {
        if (
          char === activeQuote && text[index + 1] === activeQuote &&
          text[index + 2] === activeQuote
        ) {
          index += 3;
          activeQuote = null;
          tripleQuoted = false;
        } else {
          index += 1;
        }
        continue;
      }
      if (char === activeQuote) {
        activeQuote = null;
      }
      index += 1;
      continue;
    }

    if (char === "#") {
      while (index < matchIndex && text[index] !== "\n") {
        index += 1;
      }
      continue;
    }

    if (
      (char === '"' || char === "'") && text[index + 1] === char &&
      text[index + 2] === char
    ) {
      activeQuote = char;
      tripleQuoted = true;
      index += 3;
      continue;
    }
    if (char === '"' || char === "'") {
      activeQuote = char;
      tripleQuoted = false;
      index += 1;
      continue;
    }

    if (char === "(") {
      parenDepth += 1;
    } else if (char === ")") {
      parenDepth = Math.max(0, parenDepth - 1);
    } else if (char === "[") {
      bracketDepth += 1;
    } else if (char === "]") {
      bracketDepth = Math.max(0, bracketDepth - 1);
    } else if (char === "{") {
      braceDepth += 1;
    } else if (char === "}") {
      braceDepth = Math.max(0, braceDepth - 1);
    }

    index += 1;
  }

  return parenDepth === 0 && bracketDepth === 0 && braceDepth === 0;
}

class TopLevelPythonAssignmentPattern extends RegExp {
  constructor() {
    super(PYTHON_ASSIGNMENT_PATTERN_SOURCE, "gm");
  }

  override exec(text: string): RegExpExecArray | null {
    const matcher = new RegExp(this.source, this.flags);
    matcher.lastIndex = this.lastIndex;

    let match: RegExpExecArray | null;
    while ((match = matcher.exec(text)) !== null) {
      this.lastIndex = matcher.lastIndex;
      if (
        match.index !== undefined &&
        isTopLevelPythonStatementMatch(text, match.index)
      ) {
        return match;
      }
      if (match[0].length === 0) {
        matcher.lastIndex += 1;
        this.lastIndex = matcher.lastIndex;
      }
    }

    this.lastIndex = 0;
    return null;
  }

  override [Symbol.matchAll](text: string): RegExpStringIterator<RegExpExecArray> {
    const source = this.source;
    const flags = this.flags.includes("g") ? this.flags : `${this.flags}g`;
    return (function* matchAll(
      this: TopLevelPythonAssignmentPattern,
    ): Generator<RegExpExecArray, undefined, undefined> {
      const matcher = new RegExp(source, flags);
      let match: RegExpExecArray | null;
      while ((match = matcher.exec(text)) !== null) {
        this.lastIndex = matcher.lastIndex;
        if (
          match.index !== undefined &&
          isTopLevelPythonStatementMatch(text, match.index)
        ) {
          yield match;
        }
        if (match[0].length === 0) {
          matcher.lastIndex += 1;
          this.lastIndex = matcher.lastIndex;
        }
      }
      this.lastIndex = 0;
      return undefined;
    }).call(this) as RegExpStringIterator<RegExpExecArray>;
  }
}

const PYTHON_ASSIGNMENT_PATTERN = new TopLevelPythonAssignmentPattern();

function readParenthesizedArgument(
  text: string,
  argumentStartIndex: number,
): { argument: string; endIndex: number } | null {
  const delimiterStack: Array<")" | "]" | "}"> = [")"];
  let endIndex = -1;
  forEachCodeCharacterOutsideStringsAndComments(
    text,
    argumentStartIndex,
    (index, char) => {
      const openingDelimiter =
        CLOSING_DELIMITER_BY_OPENING[char as OpeningDelimiter];
      if (openingDelimiter) {
        delimiterStack.push(openingDelimiter);
        return;
      }
      if (!CLOSING_DELIMITERS.has(char as ClosingDelimiter)) {
        return;
      }
      if (char !== delimiterStack[delimiterStack.length - 1]) {
        return;
      }
      delimiterStack.pop();
      if (delimiterStack.length === 0) {
        endIndex = index + 1;
        return false;
      }
    },
  );
  if (endIndex >= 0) {
    return {
      argument: text.slice(argumentStartIndex, endIndex - 1),
      endIndex,
    };
  }
  return null;
}

function skipWhitespace(text: string, startIndex: number): number {
  let index = startIndex;
  while (index < text.length && isWhitespaceChar(text[index])) {
    index += 1;
  }
  return index;
}

function readBalancedSegment(
  text: string,
  startIndex: number,
): { expression: string; endIndex: number } | null {
  const opener = text[startIndex];
  const closingByOpening: Record<string, string> = {
    "(": ")",
    "[": "]",
    "{": "}",
  };
  const expectedCloser = closingByOpening[opener ?? ""];
  if (!expectedCloser) return null;

  const stack = [expectedCloser];
  let index = startIndex + 1;
  let activeQuote: '"' | "'" | null = null;
  let tripleQuoted = false;
  let inComment = false;

  while (index < text.length) {
    const char = text[index];
    if (inComment) {
      if (char === "\n") inComment = false;
      index += 1;
      continue;
    }

    if (activeQuote) {
      if (char === "\\") {
        const escapeSequenceLength = (index + 1 < text.length) ? 2 : 1;
        index += escapeSequenceLength;
        continue;
      }
      if (tripleQuoted) {
        if (
          char === activeQuote && text[index + 1] === activeQuote &&
          text[index + 2] === activeQuote
        ) {
          index += 3;
          activeQuote = null;
          tripleQuoted = false;
        } else {
          index += 1;
        }
        continue;
      }
      if (char === activeQuote) activeQuote = null;
      index += 1;
      continue;
    }

    if (char === "#") {
      inComment = true;
      index += 1;
      continue;
    }

    if (
      (char === '"' || char === "'") && text[index + 1] === char &&
      text[index + 2] === char
    ) {
      activeQuote = char;
      tripleQuoted = true;
      index += 3;
      continue;
    }
    if (char === '"' || char === "'") {
      activeQuote = char;
      index += 1;
      continue;
    }

    if (char === "(" || char === "[" || char === "{") {
      stack.push(closingByOpening[char]!);
      index += 1;
      continue;
    }
    if (char === stack[stack.length - 1]) {
      stack.pop();
      index += 1;
      if (stack.length === 0) {
        return {
          expression: text.slice(startIndex, index),
          endIndex: index,
        };
      }
      continue;
    }
    index += 1;
  }

  return null;
}

function readScreenActionExpression(
  text: string,
  startIndex: number,
): { expression: string; endIndex: number } | null {
  const expressionStart = skipWhitespace(text, startIndex);
  if (expressionStart >= text.length) return null;
  const firstChar = text[expressionStart];

  if (firstChar === "(" || firstChar === "[" || firstChar === "{") {
    return readBalancedSegment(text, expressionStart);
  }

  if (!isIdentifierStart(firstChar)) {
    return null;
  }

  let identifierEnd = expressionStart + 1;
  while (identifierEnd < text.length && isIdentifierPart(text[identifierEnd])) {
    identifierEnd += 1;
  }
  const afterIdentifier = skipWhitespace(text, identifierEnd);
  if (text[afterIdentifier] !== "(") {
    return {
      expression: text.slice(expressionStart, identifierEnd),
      endIndex: identifierEnd,
    };
  }

  const parsedArguments = readParenthesizedArgument(text, afterIdentifier + 1);
  if (!parsedArguments) return null;
  return {
    expression: text.slice(expressionStart, parsedArguments.endIndex),
    endIndex: parsedArguments.endIndex,
  };
}

function isIdentifierBoundary(char: string | undefined): boolean {
  if (!char) return true;
  const code = char.charCodeAt(0);
  return !(
    (code >= 65 && code <= 90) || // A-Z
    (code >= 97 && code <= 122) || // a-z
    (code >= 48 && code <= 57) || // 0-9
    code === 95 // _
  );
}

function readIdentifier(
  text: string,
  startIndex: number,
): { identifier: string; endIndex: number } | null {
  if (!isIdentifierStart(text[startIndex])) return null;
  let endIndex = startIndex + 1;
  while (endIndex < text.length && isIdentifierPart(text[endIndex])) {
    endIndex += 1;
  }
  return {
    identifier: text.slice(startIndex, endIndex),
    endIndex,
  };
}

function allowsActionExtractionOnLine(keyword: string): boolean {
  return keyword.toLowerCase() !== "default";
}

function parseTimerDurationFromLine(lineText: string): number | undefined {
  const trimmed = lineText.trimStart();
  if (!trimmed.toLowerCase().startsWith("timer")) return undefined;
  const durationMatch = /^timer\s+([0-9]+(?:\.[0-9]+)?|\.[0-9]+)(?=[\s:]|$)/i
    .exec(trimmed);
  if (!durationMatch) return undefined;
  const durationSeconds = parseFloat(durationMatch[1]);
  return Number.isFinite(durationSeconds) ? durationSeconds : undefined;
}

function getLineRange(
  text: string,
  index: number,
): { start: number; end: number } {
  let start = index;
  while (start > 0 && text[start - 1] !== "\n") start -= 1;
  let end = index;
  while (end < text.length && text[end] !== "\n") end += 1;
  return { start, end };
}

function extractScreenActionExpressions(
  blockText: string,
): ExtractedScreenActionExpression[] {
  const ignoredMask = buildIgnoredPositionMask(blockText);
  const expressions: ExtractedScreenActionExpression[] = [];
  let currentLineFirstTopLevelIdentifier: string | null = null;
  let currentLineStartIndex = 0;
  let currentLineIndent: number | null = null;
  let processedTimerHeaderForLine = false;
  const timerBlockStack: Array<
    { indent: number; durationSeconds: number | undefined }
  > = [];

  for (let index = 0; index < blockText.length; index += 1) {
    if (blockText[index] === "\n") {
      currentLineFirstTopLevelIdentifier = null;
      currentLineStartIndex = index + 1;
      currentLineIndent = null;
      processedTimerHeaderForLine = false;
      continue;
    }
    if (currentLineIndent === null) {
      if (blockText[index] === " " || blockText[index] === "\t") continue;
      currentLineIndent = index - currentLineStartIndex;
      while (
        timerBlockStack.length > 0 &&
        currentLineIndent <= timerBlockStack[timerBlockStack.length - 1].indent
      ) {
        timerBlockStack.pop();
      }
    }
    if (ignoredMask[index]) continue;
    const identifier = readIdentifier(blockText, index);
    if (!identifier) continue;
    if (!currentLineFirstTopLevelIdentifier) {
      currentLineFirstTopLevelIdentifier = identifier.identifier;
      if (
        identifier.identifier.toLowerCase() === "timer" &&
        currentLineIndent !== null && !processedTimerHeaderForLine
      ) {
        const lineRange = getLineRange(blockText, index);
        const lineText = blockText.slice(lineRange.start, lineRange.end);
        if (lineText.trimEnd().endsWith(":")) {
          timerBlockStack.push({
            indent: currentLineIndent,
            durationSeconds: parseTimerDurationFromLine(lineText),
          });
        }
        processedTimerHeaderForLine = true;
      }
    }
    if (
      identifier.identifier === "action" &&
      allowsActionExtractionOnLine(currentLineFirstTopLevelIdentifier) &&
      isIdentifierBoundary(blockText[index - 1]) &&
      isIdentifierBoundary(blockText[identifier.endIndex])
    ) {
      let cursor = identifier.endIndex;
      if (!/\s|=/.test(blockText[cursor] ?? "")) {
        index = identifier.endIndex - 1;
        continue;
      }
      cursor = skipWhitespace(blockText, cursor);
      if (blockText[cursor] === "=") {
        cursor = skipWhitespace(blockText, cursor + 1);
      }

      const parsed = readScreenActionExpression(blockText, cursor);
      if (parsed) {
        const isTimerContext =
          currentLineFirstTopLevelIdentifier?.toLowerCase() === "timer";
        const timerBlockContext = timerBlockStack[timerBlockStack.length - 1];
        let timeout: FlowEdge["timeout"] | undefined;
        if (isTimerContext) {
          const lineRange = getLineRange(blockText, index);
          const lineText = blockText.slice(lineRange.start, lineRange.end);
          const durationSeconds = parseTimerDurationFromLine(lineText);
          timeout = {
            isTimeout: true,
            ...(durationSeconds === undefined ? {} : { durationSeconds }),
          };
        } else if (timerBlockContext) {
          timeout = {
            isTimeout: true,
            ...(timerBlockContext.durationSeconds === undefined
              ? {}
              : { durationSeconds: timerBlockContext.durationSeconds }),
          };
        }
        expressions.push({ expression: parsed.expression, timeout });
        index = parsed.endIndex - 1;
        continue;
      }
    }
    index = identifier.endIndex - 1;
  }

  return expressions;
}

function forEachCodeCharacterOutsideStringsAndComments(
  text: string,
  startIndex: number,
  visitor: (index: number, char: string) => false | void,
): void {
  let index = startIndex;
  let activeQuote: '"' | "'" | null = null;
  let tripleQuoted = false;
  let inComment = false;

  while (index < text.length) {
    const char = text[index] ?? "";
    if (inComment) {
      if (char === "\n") {
        inComment = false;
      }
      index += 1;
      continue;
    }

    if (activeQuote) {
      if (char === "\\") {
        index += (index + 1 < text.length) ? 2 : 1;
        continue;
      }
      if (tripleQuoted) {
        if (
          char === activeQuote && text[index + 1] === activeQuote &&
          text[index + 2] === activeQuote
        ) {
          index += 3;
          activeQuote = null;
          tripleQuoted = false;
        } else {
          index += 1;
        }
        continue;
      }
      if (char === activeQuote) {
        activeQuote = null;
      }
      index += 1;
      continue;
    }

    if (char === "#") {
      inComment = true;
      index += 1;
      continue;
    }
    if (
      (char === '"' || char === "'") && text[index + 1] === char &&
      text[index + 2] === char
    ) {
      activeQuote = char;
      tripleQuoted = true;
      index += 3;
      continue;
    }
    if (char === '"' || char === "'") {
      activeQuote = char;
      index += 1;
      continue;
    }

    if (visitor(index, char) === false) {
      return;
    }
    index += 1;
  }
}

function splitTopLevelArguments(argumentList: string): string[] {
  const args: string[] = [];
  const delimiterStack: ClosingDelimiter[] = [];
  let start = 0;

  forEachCodeCharacterOutsideStringsAndComments(
    argumentList,
    0,
    (index, char) => {
      const openingDelimiter =
        CLOSING_DELIMITER_BY_OPENING[char as OpeningDelimiter];
      if (openingDelimiter) {
        delimiterStack.push(openingDelimiter);
        return;
      }
      if (CLOSING_DELIMITERS.has(char as ClosingDelimiter)) {
        if (char === delimiterStack[delimiterStack.length - 1]) {
          delimiterStack.pop();
        }
        return;
      }
      if (delimiterStack.length === 0 && char === ",") {
        const segment = argumentList.slice(start, index).trim();
        if (segment) args.push(segment);
        start = index + 1;
      }
    },
  );

  const last = argumentList.slice(start).trim();
  if (last) args.push(last);
  return args;
}

function findTopLevelDelimiterIndex(
  text: string,
  delimiter: "," | "=" | ":",
): number {
  const delimiterStack: ClosingDelimiter[] = [];
  let foundIndex = -1;
  forEachCodeCharacterOutsideStringsAndComments(text, 0, (index, char) => {
    const openingDelimiter =
      CLOSING_DELIMITER_BY_OPENING[char as OpeningDelimiter];
    if (openingDelimiter) {
      delimiterStack.push(openingDelimiter);
      return;
    }
    if (CLOSING_DELIMITERS.has(char as ClosingDelimiter)) {
      if (char === delimiterStack[delimiterStack.length - 1]) {
        delimiterStack.pop();
      }
      return;
    }
    if (delimiterStack.length === 0 && char === delimiter) {
      foundIndex = index;
      return false;
    }
  });
  if (foundIndex >= 0) return foundIndex;
  return -1;
}

function extractStaticTargetsFromArgumentList(
  state: ParseGraphState | undefined,
  argumentList: string,
  scanState: ParseScanState,
): string[] {
  const args = splitTopLevelArguments(argumentList);
  if (args.length === 0) return [];

  const firstArgument = args[0];
  const targets = resolveExpressionTargets(
    scanState,
    firstArgument,
    true,
    state,
  );
  if (targets.length > 0) return targets;

  const preferredKeywordNames = new Set(["label", "target"]);
  for (const arg of args) {
    const equalsIndex = findTopLevelDelimiterIndex(arg, "=");
    if (equalsIndex <= 0) continue;
    const keyword = arg.slice(0, equalsIndex).trim().toLowerCase();
    if (!preferredKeywordNames.has(keyword)) continue;
    const kwTargets = resolveExpressionTargets(
      scanState,
      arg.slice(equalsIndex + 1),
      true,
      state,
    );
    if (kwTargets.length > 0) return kwTargets;
  }

  const equalsIndex = findTopLevelDelimiterIndex(firstArgument, "=");
  if (equalsIndex <= 0) return [];
  return resolveExpressionTargets(
    scanState,
    firstArgument.slice(equalsIndex + 1),
    true,
    state,
  );
}

function extractNestedExpressionValue(expression: string): string {
  const equalsIndex = findTopLevelDelimiterIndex(expression, "=");
  if (equalsIndex > 0) {
    return expression.slice(equalsIndex + 1).trim();
  }
  return expression.trim();
}

function isRecursiveScreenActionWrapper(construct: string): boolean {
  return RECURSIVE_SCREEN_ACTION_WRAPPER_NAMES.has(construct.toLowerCase());
}

function walkScreenActionExpression(
  expression: string,
  visitCall: (construct: string, argumentList: string) => void,
): void {
  const trimmed = expression.trim();
  if (!trimmed) return;

  const balancedRoot = readScreenActionExpression(trimmed, 0);
  if (!balancedRoot || balancedRoot.endIndex !== trimmed.length) return;

  const opener = trimmed[0];
  if (opener === "[" || opener === "(" || opener === "{") {
    const inner = trimmed.slice(1, -1);
    for (const item of splitTopLevelArguments(inner)) {
      if (opener === "{") {
        const colonIndex = findTopLevelDelimiterIndex(item, ":");
        if (colonIndex > -1) {
          walkScreenActionExpression(item.slice(colonIndex + 1), visitCall);
          continue;
        }
      }
      walkScreenActionExpression(extractNestedExpressionValue(item), visitCall);
    }
    return;
  }

  let identifierEnd = 1;
  while (
    identifierEnd < trimmed.length && isIdentifierPart(trimmed[identifierEnd])
  ) {
    identifierEnd += 1;
  }
  const construct = trimmed.slice(0, identifierEnd);
  const afterIdentifier = skipWhitespace(trimmed, identifierEnd);
  if (trimmed[afterIdentifier] !== "(") return;

  const parsedArguments = readParenthesizedArgument(
    trimmed,
    afterIdentifier + 1,
  );
  if (!parsedArguments || parsedArguments.endIndex !== trimmed.length) return;

  visitCall(construct, parsedArguments.argument);
  if (!isRecursiveScreenActionWrapper(construct)) {
    return;
  }
  for (const argument of splitTopLevelArguments(parsedArguments.argument)) {
    walkScreenActionExpression(
      extractNestedExpressionValue(argument),
      visitCall,
    );
  }
}

function buildIgnoredPositionMask(text: string): boolean[] {
  const ignored = new Array<boolean>(text.length).fill(false);
  let activeQuote: '"' | "'" | null = null;
  let tripleQuoted = false;
  let inComment = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (inComment) {
      ignored[i] = true;
      if (char === "\n") inComment = false;
      continue;
    }

    if (activeQuote) {
      ignored[i] = true;
      if (char === "\\") {
        if (i + 1 < text.length) {
          ignored[i + 1] = true;
          i += 1;
        }
        continue;
      }
      if (tripleQuoted) {
        if (
          char === activeQuote && text[i + 1] === activeQuote &&
          text[i + 2] === activeQuote
        ) {
          ignored[i + 1] = true;
          ignored[i + 2] = true;
          i += 2;
          activeQuote = null;
          tripleQuoted = false;
        }
        continue;
      }
      if (char === activeQuote) activeQuote = null;
      continue;
    }

    if (char === "#") {
      ignored[i] = true;
      inComment = true;
      continue;
    }

    if (
      (char === '"' || char === "'") && text[i + 1] === char &&
      text[i + 2] === char
    ) {
      ignored[i] = true;
      if (i + 1 < text.length) ignored[i + 1] = true;
      if (i + 2 < text.length) ignored[i + 2] = true;
      i += 2;
      activeQuote = char;
      tripleQuoted = true;
      continue;
    }

    if (char === '"' || char === "'") {
      ignored[i] = true;
      activeQuote = char;
      tripleQuoted = false;
    }
  }

  return ignored;
}

export function stripInlineComment(value: string): string {
  let activeQuote: '"' | "'" | null = null;
  let tripleQuoted = false;
  for (let i = 0; i < value.length; i += 1) {
    const char = value[i];
    if (activeQuote) {
      if (char === "\\") {
        i += 1;
        continue;
      }
      if (tripleQuoted) {
        if (
          i + 2 < value.length &&
          char === activeQuote &&
          value[i + 1] === activeQuote &&
          value[i + 2] === activeQuote
        ) {
          i += 2;
          activeQuote = null;
          tripleQuoted = false;
        }
        continue;
      }
      if (char === activeQuote) activeQuote = null;
      continue;
    }
    if (
      i + 2 < value.length &&
      (char === '"' || char === "'") &&
      value[i + 1] === char &&
      value[i + 2] === char
    ) {
      activeQuote = char;
      tripleQuoted = true;
      i += 2;
      continue;
    }
    if (char === '"' || char === "'") {
      activeQuote = char;
      continue;
    }
    if (char === "#") {
      return value.slice(0, i).trim();
    }
  }
  return value.trim();
}

/**
 * Analyzes direct Python code blocks or inline statements (e.g., `$ renpy.jump("lbl")`)
 * to resolve variable assignments and register control flow jumps/calls.
 */
export function processDirectRenpyBlockCalls(
  state: ParseGraphState,
  scanState: ParseScanState,
  meta: TokenMetaFlags,
  chapter: string,
  menuDepth: number,
  blockText: string,
) {
  interface PythonAssignmentEvent {
    kind: "assignment";
    index: number;
    variableName: string;
    assignedTarget: string | null;
    assignedDict?: Map<string, string> | null;
    assignedList?: string[] | null;
  }

  interface PythonRenpyCallEvent {
    kind: "call";
    index: number;
    callType: "jump" | "call";
    construct: "renpy.jump" | "renpy.call";
    targetExpression: string;
  }

  const events: Array<PythonAssignmentEvent | PythonRenpyCallEvent> = [];
  PYTHON_RENPY_CALL_START_PATTERN.lastIndex = 0;
  const ignoredMask = buildIgnoredPositionMask(blockText);
  let match: RegExpExecArray | null;
  while ((match = PYTHON_RENPY_CALL_START_PATTERN.exec(blockText)) !== null) {
    if (ignoredMask[match.index]) {
      continue;
    }
    const callType = match[1] === "jump" ? "jump" : "call";
    const construct = callType === "jump" ? "renpy.jump" : "renpy.call";
    const parsed = readParenthesizedArgument(
      blockText,
      PYTHON_RENPY_CALL_START_PATTERN.lastIndex,
    );
    if (!parsed) continue;
    PYTHON_RENPY_CALL_START_PATTERN.lastIndex = parsed.endIndex;
    events.push({
      kind: "call",
      index: match.index,
      callType,
      construct,
      targetExpression: parsed.argument,
    });
  }

  PYTHON_ASSIGNMENT_PATTERN.lastIndex = 0;
  while ((match = PYTHON_ASSIGNMENT_PATTERN.exec(blockText)) !== null) {
    if (ignoredMask[match.index]) continue;
    const variableName = (match[1] ?? "").trim();
    if (!variableName) continue;
    const assignedExpression = stripInlineComment(match[2] ?? "");
    const assignedTarget = resolveStaticTargetExpression(
      assignedExpression,
      scanState,
      state,
    );
    const assignedDict = parseDictLiteral(assignedExpression);
    const assignedList = parseListLiteral(assignedExpression);
    events.push({
      kind: "assignment",
      index: match.index,
      variableName,
      assignedTarget,
      assignedDict,
      assignedList,
    });
  }

  events.sort((a, b) => a.index - b.index);

  for (const event of events) {
    if (event.kind === "assignment") {
      if (event.assignedTarget) {
        scanState.labelVariableLiteralTargets.set(
          event.variableName,
          event.assignedTarget,
        );
        scanState.labelVariableDictTargets.delete(event.variableName);
        scanState.labelVariableListTargets.delete(event.variableName);
      } else if (event.assignedDict) {
        scanState.labelVariableDictTargets.set(
          event.variableName,
          event.assignedDict,
        );
        scanState.labelVariableLiteralTargets.delete(event.variableName);
        scanState.labelVariableListTargets.delete(event.variableName);
      } else if (event.assignedList) {
        scanState.labelVariableListTargets.set(
          event.variableName,
          event.assignedList,
        );
        scanState.labelVariableLiteralTargets.delete(event.variableName);
        scanState.labelVariableDictTargets.delete(event.variableName);
      } else {
        scanState.labelVariableLiteralTargets.delete(event.variableName);
        scanState.labelVariableDictTargets.delete(event.variableName);
        scanState.labelVariableListTargets.delete(event.variableName);
      }
      continue;
    }

    const context = resolveCallContext(scanState, meta, menuDepth);
    const targets = extractStaticTargetsFromArgumentList(
      state,
      event.targetExpression,
      scanState,
    );
    if (targets.length === 0) {
      addDynamicTargetDiagnostic(
        state,
        chapter,
        event.construct,
        event.targetExpression,
        context.source ?? undefined,
      );
      continue;
    }

    for (const target of targets) {
      if (event.callType === "jump") {
        emitJumpEdge(state, scanState, target, context, false);
      } else {
        emitCallEdge(state, scanState, target, context);
      }
    }
  }
}

/**
 * Extracts action methods from Ren'Py screen blocks and generates corresponding flowchart edges.
 */
export function processDirectScreenActionCalls(
  state: ParseGraphState,
  scanState: ParseScanState,
  meta: TokenMetaFlags,
  chapter: string,
  menuDepth: number,
  blockText: string,
  screenActionRuleMap: Map<string, ScreenActionKind>,
) {
  const seenCalls = new Set<string>();
  const emitActionCall = (
    construct: string,
    targetExpression: string,
    timeout?: FlowEdge["timeout"],
  ) => {
    const callType = screenActionRuleMap.get(construct.toLowerCase());
    if (!callType) return;
    const context = resolveCallContext(scanState, meta, menuDepth);
    const targets = extractStaticTargetsFromArgumentList(
      state,
      targetExpression,
      scanState,
    );
    if (targets.length === 0) {
      addDynamicTargetDiagnostic(
        state,
        chapter,
        construct,
        targetExpression,
        context.source ?? undefined,
      );
      return;
    }
    for (const target of targets) {
      const dedupeKey = [
        construct.toLowerCase(),
        target,
        context.source ?? "",
        timeout?.isTimeout
          ? `timeout:${
            timeout.durationSeconds === undefined
              ? "unknown"
              : timeout.durationSeconds
          }`
          : "normal",
      ].join("|");
      if (seenCalls.has(dedupeKey)) continue;
      seenCalls.add(dedupeKey);
      if (callType === "jump") {
        emitJumpEdge(state, scanState, target, context, false, timeout);
      } else {
        emitCallEdge(state, scanState, target, context, timeout);
      }
    }
  };

  for (const extracted of extractScreenActionExpressions(blockText)) {
    walkScreenActionExpression(
      extracted.expression,
      (construct, targetExpression) =>
        emitActionCall(construct, targetExpression, extracted.timeout),
    );
  }
}

/**
 * Resets wait flags to prevent dangling parsing rules on malformed script streams.
 */
export function resetStaleWaitFlags(
  scanState: ParseScanState,
  type: number,
): void {
  if (
    type === PARSER_TOKENS.charWhitespace || type === PARSER_TOKENS.charNewline
  ) return;
  if (type === PARSER_TOKENS.kwLabel || isMenuKeywordTokenType(type)) {
    scanState.waitForJumpTarget = false;
    scanState.waitForJumpExpressionTarget = false;
    scanState.waitForCallTarget = false;
    scanState.waitForMenuNameForId = null;
    return;
  }
  const isJumpTargetTokenCheck = type === PARSER_TOKENS.entityFunctionName ||
    (PARSER_TOKENS.entityIdentifier !== undefined &&
      type === PARSER_TOKENS.entityIdentifier);

  if (scanState.waitForJumpTarget && !isJumpTargetTokenCheck) {
    if (
      PARSER_TOKENS.kwExpression !== undefined &&
      type === PARSER_TOKENS.kwExpression
    ) {
      scanState.waitForJumpExpressionTarget = true;
    } else if (
      (PARSER_TOKENS.metaItemAccess !== undefined &&
        type === PARSER_TOKENS.metaItemAccess) ||
      (PARSER_TOKENS.metaFunctionCall !== undefined &&
        type === PARSER_TOKENS.metaFunctionCall)
    ) {
      // Keep waiting for target
    } else {
      scanState.waitForJumpTarget = false;
      scanState.waitForJumpExpressionTarget = false;
    }
  }
  const isCallTargetTokenCheck = type === PARSER_TOKENS.entityFunctionName ||
    (PARSER_TOKENS.entityIdentifier !== undefined &&
      type === PARSER_TOKENS.entityIdentifier);

  if (scanState.waitForCallTarget && !isCallTargetTokenCheck) {
    scanState.waitForCallTarget = false;
  }
  if (
    scanState.waitForMenuNameForId && type !== PARSER_TOKENS.entityFunctionName
  ) {
    scanState.waitForMenuNameForId = null;
  }
}
