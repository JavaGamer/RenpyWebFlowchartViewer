import type {
  ExtractedScreenActionExpression,
  ParseGraphState,
  ParseScanState,
  ScreenActionTarget,
  ScreenDefinition,
} from "../../pipelineTypes.ts";
import type { FlowEdge } from "../../../domain/index.ts";
import { resolveExpressionTargets } from "../jumpCallHandler.ts";
import { addParseDiagnostic } from "../../diagnostics.ts";
import type { ScreenActionKind } from "../../../config/parserRules.ts";
import {
  buildIgnoredPositionMask,
  findTopLevelDelimiterIndex,
  isIdentifierBoundary,
  isIdentifierPart,
  isIdentifierStart,
  readBalancedSegment,
  readIdentifier,
  readParenthesizedArgument,
  skipWhitespace,
  splitTopLevelArguments,
} from "./bracketMatcher.ts";

const RECURSIVE_SCREEN_ACTION_WRAPPER_NAMES = new Set([
  "if",
  "selectedif",
  "sensitiveif",
  "showif",
  "confirm",
]);

const SCREEN_ACTION_TRIGGER_KEYWORDS = new Set([
  "action",
  "selected_action",
  "alternate",
]);

export function readScreenActionExpression(
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

export function allowsActionExtractionOnLine(keyword: string | null): boolean {
  return keyword ? keyword.toLowerCase() !== "default" : true;
}

export function parseTimerDurationFromLine(
  lineText: string,
): number | undefined {
  const trimmed = lineText.trimStart();
  if (!trimmed.toLowerCase().startsWith("timer")) return undefined;
  const durationMatch = /^timer\s+([0-9]+(?:\.[0-9]+)?|\.[0-9]+)(?=[\s:]|$)/i
    .exec(trimmed);
  if (!durationMatch) return undefined;
  const durationSeconds = parseFloat(durationMatch[1]);
  return Number.isFinite(durationSeconds) ? durationSeconds : undefined;
}

export function getLineRange(
  text: string,
  index: number,
): { start: number; end: number } {
  let start = index;
  while (start > 0 && text[start - 1] !== "\n") start -= 1;
  let end = index;
  while (end < text.length && text[end] !== "\n") end += 1;
  return { start, end };
}

export function extractScreenActionExpressions(
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
      SCREEN_ACTION_TRIGGER_KEYWORDS.has(identifier.identifier.toLowerCase()) &&
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

export function extractStaticTargetsFromArgumentList(
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
  ).filter((t) => t.trim() !== "");
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

export function extractScreenActionTarget(argumentList: string): string {
  const args = splitTopLevelArguments(argumentList);
  if (args.length === 0) return "";
  const first = args[0]!.trim();
  const equalsIndex = findTopLevelDelimiterIndex(first, "=");
  if (equalsIndex > 0) {
    const kw = first.slice(0, equalsIndex).trim().toLowerCase();
    if (kw === "target" || kw === "label" || kw === "screen" || kw === "name") {
      return first.slice(equalsIndex + 1).trim();
    }
  } else if (first.length > 0) {
    return first;
  }
  for (let i = 1; i < args.length; i++) {
    const arg = args[i]!.trim();
    const eqIdx = findTopLevelDelimiterIndex(arg, "=");
    if (eqIdx > 0) {
      const kw = arg.slice(0, eqIdx).trim().toLowerCase();
      if (
        kw === "target" || kw === "label" || kw === "screen" || kw === "name"
      ) {
        return arg.slice(eqIdx + 1).trim();
      }
    }
  }
  return extractNestedExpressionValue(argumentList);
}

export function extractNestedExpressionValue(expression: string): string {
  const equalsIndex = findTopLevelDelimiterIndex(expression, "=");
  if (equalsIndex > 0) {
    return expression.slice(equalsIndex + 1).trim();
  }
  return expression.trim();
}

export function isRecursiveScreenActionWrapper(construct: string): boolean {
  return RECURSIVE_SCREEN_ACTION_WRAPPER_NAMES.has(construct.toLowerCase());
}

function splitTopLevelTernary(
  expr: string,
): { trueBranch: string; falseBranch: string } | null {
  let depth = 0;
  let inQuote: string | null = null;
  let ifIndex = -1;
  let elseIndex = -1;
  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i]!;
    if (inQuote) {
      if (ch === inQuote && expr[i - 1] !== "\\") inQuote = null;
    } else if (ch === '"' || ch === "'") {
      inQuote = ch;
    } else if (ch === "(" || ch === "[" || ch === "{") {
      depth++;
    } else if (ch === ")" || ch === "]" || ch === "}") {
      if (depth > 0) depth--;
    } else if (depth === 0) {
      if (expr.startsWith(" if ", i) || expr.startsWith("\tif\t", i)) {
        if (ifIndex === -1) {
          ifIndex = i;
        }
      } else if (
        ifIndex > -1 &&
        (expr.startsWith(" else ", i) || expr.startsWith("\telse\t", i))
      ) {
        elseIndex = i;
        break;
      }
    }
  }
  if (ifIndex > 0 && elseIndex > ifIndex) {
    const trueBranch = expr.slice(0, ifIndex).trim();
    const falseBranch = expr.slice(elseIndex + 6).trim();
    if (trueBranch && falseBranch) {
      return { trueBranch, falseBranch };
    }
  }
  return null;
}

export function walkScreenActionExpression(
  expression: string,
  visitCall: (construct: string, argumentList: string) => void,
): void {
  const trimmed = expression.trim();
  if (!trimmed) return;

  const ternary = splitTopLevelTernary(
    trimmed.startsWith("(") && trimmed.endsWith(")")
      ? trimmed.slice(1, -1).trim()
      : trimmed,
  );
  if (ternary) {
    walkScreenActionExpression(ternary.trueBranch, visitCall);
    walkScreenActionExpression(ternary.falseBranch, visitCall);
    return;
  }

  const balancedRoot = readScreenActionExpression(trimmed, 0);
  if (!balancedRoot) return;
  const rootRemainder = trimmed.slice(balancedRoot.endIndex).trim();
  if (rootRemainder.length > 0 && !rootRemainder.startsWith("#")) return;

  const opener = trimmed[0];
  if (opener === "[" || opener === "(" || opener === "{") {
    const inner = trimmed.slice(1, balancedRoot.endIndex - 1);
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
  const len = trimmed.length;
  while (
    identifierEnd < len && isIdentifierPart(trimmed[identifierEnd])
  ) {
    identifierEnd += 1;
  }
  const construct = trimmed.slice(0, identifierEnd);
  const afterIdentifier = skipWhitespace(trimmed, identifierEnd);
  if (
    afterIdentifier >= len ||
    trimmed[afterIdentifier] === "#" ||
    trimmed[afterIdentifier] === ","
  ) {
    visitCall(construct, "");
    return;
  }
  if (trimmed[afterIdentifier] !== "(") return;
  const parsedArguments = readParenthesizedArgument(
    trimmed,
    afterIdentifier + 1,
  );
  if (!parsedArguments) return;
  const remainder = trimmed.slice(parsedArguments.endIndex).trim();
  if (remainder.length > 0 && !remainder.startsWith("#")) return;

  visitCall(construct, parsedArguments.argument);

  const lower = construct.toLowerCase();
  if (lower === "confirm" || lower === "if") {
    const args = splitTopLevelArguments(parsedArguments.argument);
    for (let i = 0; i < args.length; i += 1) {
      const arg = args[i];
      const equalsIndex = findTopLevelDelimiterIndex(arg, "=");
      if (equalsIndex > 0) {
        const kw = arg.slice(0, equalsIndex).trim().toLowerCase();
        if (
          kw === "yes" || kw === "no" || kw === "yes_action" ||
          kw === "no_action" || kw === "true" || kw === "false" ||
          kw === "true_action" || kw === "false_action"
        ) {
          walkScreenActionExpression(
            arg.slice(equalsIndex + 1).trim(),
            visitCall,
          );
        }
      } else if (i === 1 || i === 2) {
        walkScreenActionExpression(arg.trim(), visitCall);
      }
    }
    return;
  }

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

const BUILTIN_IGNORED_ACTIONS = new Set([
  "confirm",
  "if",
  "selectedif",
  "sensitiveif",
  "showif",
  "nullaction",
  "start",
  "play",
  "stop",
  "queue",
  "voice",
  "with",
  "notify",
  "help",
  "preference",
  "function",
  "setdict",
  "setfield",
  "rollback",
  "screenshot",
  "quit",
  "hide",
  "show",
  "showtransient",
  "togglescreen",
  "setvariable",
  "togglevariable",
  "setscreenvariable",
  "togglescreenvariable",
  "setlocalvariable",
  "togglelocalvariable",
  "mainmenu",
  "fileaction",
  "filesave",
  "fileload",
  "filedelete",
  "filepage",
  "filepagenext",
  "filepageprevious",
  "filetakescreenshot",
  "filepagetotals",
  "filepageempty",
  "quicksave",
  "quickload",
  "skip",
  "rollforward",
  "setmute",
  "togglemute",
  "pauseaudio",
  "hideinterface",
  "openurl",
  "mousemovescaling",
  "return",
]);

export function parseScreenDefinition(
  name: string,
  filePath: string,
  lineIndex: number,
  rawBody: string,
  screenActionRuleMap?: Map<string, ScreenActionKind>,
  state?: ParseGraphState,
): ScreenDefinition {
  const actions: ScreenActionTarget[] = [];
  let hasReturnAction = false;
  const isEngineChoiceScreen = name === "choice";

  const extracted = extractScreenActionExpressions(rawBody);
  for (const { expression, timeout } of extracted) {
    walkScreenActionExpression(expression, (construct, argumentList) => {
      const lower = construct.toLowerCase();
      const mappedKind = screenActionRuleMap?.get(lower);

      if (lower === "jump" || mappedKind === "jump") {
        const rawTarget = extractScreenActionTarget(argumentList);
        const cleanTarget = rawTarget.replace(/^["']|["']$/g, "").trim();
        actions.push({
          construct: "jump",
          targetExpression: rawTarget,
          target: cleanTarget,
          timeout,
        });
      } else if (lower === "call" || mappedKind === "call") {
        const rawTarget = extractScreenActionTarget(argumentList);
        const cleanTarget = rawTarget.replace(/^["']|["']$/g, "").trim();
        actions.push({
          construct: "call",
          targetExpression: rawTarget,
          target: cleanTarget,
          timeout,
        });
      } else if (lower === "showmenu" || mappedKind === "show_menu") {
        const rawTarget = extractScreenActionTarget(argumentList);
        const cleanTarget = rawTarget.replace(/^["']|["']$/g, "").trim();
        actions.push({
          construct: "show_menu",
          targetExpression: rawTarget,
          target: cleanTarget,
          timeout,
        });
      } else if (lower === "return") {
        hasReturnAction = true;
        actions.push({
          construct: "return",
          targetExpression: argumentList,
          timeout,
        });
      } else if (lower === "setvariable" || mappedKind === "set_variable") {
        const parts = splitTopLevelArguments(argumentList);
        if (parts.length >= 2) {
          const varName = parts[0].replace(/^["']|["']$/g, "").trim();
          const rawVal = parts[1].trim();
          actions.push({
            construct: "set_variable",
            targetExpression: rawVal,
            variableName: varName,
            variableValue: rawVal.replace(/^["']|["']$/g, ""),
            timeout,
          });
        }
      } else if (
        lower === "togglevariable" || mappedKind === "toggle_variable"
      ) {
        const varName = extractNestedExpressionValue(argumentList).replace(
          /^["']|["']$/g,
          "",
        ).trim();
        actions.push({
          construct: "toggle_variable",
          targetExpression: "toggle",
          variableName: varName,
          timeout,
        });
      } else if (
        mappedKind === "null_action" || BUILTIN_IGNORED_ACTIONS.has(lower)
      ) {
        // Ignored action or null_action, no-op
      } else if (!mappedKind) {
        // Unmapped screen action!
        if (state && construct && /^[A-Za-z_][A-Za-z0-9_]*$/.test(construct)) {
          addParseDiagnostic(
            state,
            {
              code: "unmapped_screen_action",
              severity: "warning",
              message:
                `Screen action "${construct}" is not mapped to any control flow behavior.`,
              recoveryAction:
                `Map "${construct}" to jump or call in Parser Variant Settings.`,
              location: {
                chapter: filePath,
                lineNum: lineIndex,
                construct: "screen_action",
                actionName: construct,
                targetExpression: argumentList || undefined,
              },
            },
            `unmapped_screen_action|${construct.toLowerCase()}`,
          );
        }
      }
    });
  }

  return {
    name,
    filePath,
    lineIndex,
    rawBody,
    actions,
    hasReturnAction,
    isEngineChoiceScreen,
  };
}
