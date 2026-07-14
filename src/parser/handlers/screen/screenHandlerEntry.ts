import type {
  ParseGraphState,
  ParseScanState,
  TokenMetaFlags,
} from "../../pipelineTypes.ts";
import type { ScreenActionKind } from "../../../config/parserRules.ts";
import { isMenuKeywordTokenType, PARSER_TOKENS } from "../../parserTokens.ts";
import {
  addDynamicTargetDiagnostic,
  emitCallEdge,
  emitJumpEdge,
  parseDictLiteral,
  parseListLiteral,
  resolveCallContext,
  resolveStaticTargetExpression,
} from "../jumpCallHandler.ts";
import type { FlowEdge } from "../../../domain/index.ts";
import {
  buildIgnoredPositionMask,
  readParenthesizedArgument,
} from "./bracketMatcher.ts";
import {
  extractScreenActionExpressions,
  extractStaticTargetsFromArgumentList,
  walkScreenActionExpression,
} from "./screenActionExtractor.ts";

const PYTHON_RENPY_CALL_START_PATTERN = /\brenpy\.(jump|call)\s*\(/g;
const PYTHON_ASSIGNMENT_PATTERN_SOURCE =
  "^[ \\t]*([A-Za-z_][A-Za-z0-9_]*)(?:[ \\t]*:[^=\\n#]+)?[ \\t]*=(?!=)([^\\n]*)$";

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
        requireTopLevelMatch(text, match.index)
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
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    return (function* matchAll(): Generator<RegExpExecArray, undefined, undefined> {
      const matcher = new RegExp(source, flags);
      let match: RegExpExecArray | null;
      while ((match = matcher.exec(text)) !== null) {
        self.lastIndex = matcher.lastIndex;
        if (
          match.index !== undefined &&
          requireTopLevelMatch(text, match.index)
        ) {
          yield match;
        }
        if (match[0].length === 0) {
          matcher.lastIndex += 1;
          self.lastIndex = matcher.lastIndex;
        }
      }
      self.lastIndex = 0;
      return undefined;
    })() as RegExpStringIterator<RegExpExecArray>;
  }
}

// Synchronous helper to avoid require/import issues inside exec
import { isTopLevelPythonStatementMatch } from "./bracketMatcher.ts";
function requireTopLevelMatch(text: string, matchIndex: number): boolean {
  return isTopLevelPythonStatementMatch(text, matchIndex);
}

const PYTHON_ASSIGNMENT_PATTERN = new TopLevelPythonAssignmentPattern();

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
