import { isMenuKeywordTokenType, PARSER_TOKENS } from "./parserTokens.ts";
import type {
  ExtractedScreenActionExpression,
  ParseGraphState,
  ParseScanState,
  ResolveTargetScanState,
  TokenMetaFlags,
} from "./pipelineTypes.ts";
import {
  edgeIdWithOption,
  menuAtDepth,
  parentMenuStackLength,
} from "./scanTransitions.ts";
import { addEdge, addIncoming, addNode, addOutgoing } from "./graphMutations.ts";
import { assertInvariant } from "./pipelineInvariants.ts";
import type { ScreenActionKind } from "../config/parserRules.ts";
import { addParseDiagnostic } from "./diagnostics.ts";
import {
  type ConditionMetadata,
  extractConditionFlagRefs,
  type FlowEdge,
} from "../domain/index.ts";

interface HandleTokenInput {
  type: number;
  meta: TokenMetaFlags;
  val: () => string;
  chapter: string;
  menuDepth: number;
  lineIndent: number;
  lineText: string;
  captureDialogueLines: boolean;
  screenActionRuleMap: Map<string, ScreenActionKind>;
  sceneSplitDialogueThreshold?: number;
}

/** Checks if a label node has any registered outgoing sequence or jump edges. */
function hasOutgoingEdge(state: ParseGraphState, sourceId: string): boolean {
  return state.outgoingByLabel.has(sourceId);
}

/**
 * Determines whether the current scanner position lies within the indentation scope
 * of the currently active label block.
 */
function isWithinCurrentLabelScope(
  scanState: ParseScanState,
  meta: TokenMetaFlags,
  lineIndent: number,
): boolean {
  if (meta.hasLabelStatement) {
    return true;
  }
  if (
    scanState.currentLabelId === null || scanState.currentLabelIndent === null
  ) {
    return false;
  }
  return lineIndent > scanState.currentLabelIndent;
}

const LABEL_SCENE_ID_SEPARATOR = "__scene_";

function toSceneLabelId(baseLabelId: string, sceneIndex: number): string {
  return `${baseLabelId}${LABEL_SCENE_ID_SEPARATOR}${sceneIndex}`;
}

function replaceSetEntry(set: Set<string>, fromId: string, toId: string): void {
  if (!set.delete(fromId)) return;
  set.add(toId);
}

function remapMapKey<T>(
  map: Map<string, T>,
  fromId: string,
  toId: string,
): void {
  if (!map.has(fromId)) return;
  const value = map.get(fromId) as T;
  map.delete(fromId);
  map.set(toId, value);
}

/**
 * Re-maps all incoming references, outgoing connections, and label definition indices
 * from an old label ID to a new label ID. Used when a label is split into scenes.
 */
function remapLabelIdReferences(
  state: ParseGraphState,
  fromId: string,
  toId: string,
): void {
  if (fromId === toId) return;
  const node = state.nodeMap.get(fromId);
  if (node) {
    node.id = toId;
    state.nodeMap.delete(fromId);
    state.nodeMap.set(toId, node);
  }
  if (state.nodeIds.delete(fromId)) state.nodeIds.add(toId);
  if (state.allLabelIds.delete(fromId)) state.allLabelIds.add(toId);
  remapMapKey(state.outgoingByLabel, fromId, toId);
  remapMapKey(state.incomingByLabel, fromId, toId);
  replaceSetEntry(state.hasReturnInLabel, fromId, toId);
  replaceSetEntry(state.hasReliableReturnInLabel, fromId, toId);
  replaceSetEntry(state.calledLabels, fromId, toId);
  replaceSetEntry(state.calledFromMenuOptionTargets, fromId, toId);

  for (const pendingCallReturn of state.pendingCallReturns) {
    if (pendingCallReturn.returnTargetId === fromId) {
      pendingCallReturn.returnTargetId = toId;
    }
    if (pendingCallReturn.callTargetId === fromId) {
      pendingCallReturn.callTargetId = toId;
    }
  }
  for (const edge of state.edges) {
    if (edge.source === fromId) edge.source = toId;
    if (edge.target === fromId) edge.target = toId;
  }
  for (const stateNode of state.nodeMap.values()) {
    if (stateNode.parentLabelId === fromId) {
      stateNode.parentLabelId = toId;
    }
  }
  for (
    const [labelName, canonicalLabelId] of state.canonicalLabelIdByName
      .entries()
  ) {
    if (canonicalLabelId === fromId) {
      state.canonicalLabelIdByName.set(labelName, toId);
    }
  }

  // Update state.graph incrementally
  if (state.graph.hasNode(fromId)) {
    const edges = state.graph.edges(fromId);
    const edgeDataMap = new Map<
      string,
      { source: string; target: string; data: FlowEdge }
    >();
    for (const edgeId of edges) {
      const source = state.graph.source(edgeId);
      const target = state.graph.target(edgeId);
      const data = state.graph.getEdgeAttributes(edgeId);
      edgeDataMap.set(edgeId, { source, target, data });
      state.graph.dropEdge(edgeId);
    }
    state.graph.dropNode(fromId);
    if (node) {
      state.graph.addNode(toId, node);
    }
    for (const [edgeId, edgeInfo] of edgeDataMap.entries()) {
      const newSource = edgeInfo.source === fromId ? toId : edgeInfo.source;
      const newTarget = edgeInfo.target === fromId ? toId : edgeInfo.target;
      if (state.graph.hasNode(newSource) && state.graph.hasNode(newTarget)) {
        state.graph.addDirectedEdgeWithKey(
          edgeId,
          newSource,
          newTarget,
          edgeInfo.data,
        );
      } else {
        state.pendingGraphEdgeIds.add(edgeId);
      }
    }
  }

  for (const edgeId of [...state.pendingGraphEdgeIds]) {
    const edge = state.edges.find((e) => e.id === edgeId);
    if (
      edge && state.graph.hasNode(edge.source) &&
      state.graph.hasNode(edge.target)
    ) {
      if (!state.graph.hasEdge(edge.id)) {
        state.graph.addDirectedEdgeWithKey(
          edge.id,
          edge.source,
          edge.target,
          edge,
        );
      }
      state.pendingGraphEdgeIds.delete(edgeId);
    }
  }
}

function createDecisionConditionMetadata(
  decisionContext:
    | ParseScanState["conditionalDecisionStack"][number]
    | undefined,
): ConditionMetadata | undefined {
  if (!decisionContext) return undefined;
  return {
    branchKind: decisionContext.branchKind,
    expression: decisionContext.expression ?? undefined,
    references: decisionContext.references,
    decisionNodeId: decisionContext.decisionNodeId,
  };
}

function connectSceneSplitFromSource(
  state: ParseGraphState,
  sourceId: string,
  nextSceneId: string,
  label?: string,
  condition?: ConditionMetadata,
): void {
  const baseEdgeId = `seq_${sourceId}__${nextSceneId}`;
  addEdge(state, {
    id: label ? edgeIdWithOption(baseEdgeId, label) : baseEdgeId,
    source: sourceId,
    target: nextSceneId,
    kind: "sequence",
    label,
    condition,
  });
  addOutgoing(state, sourceId, "sequence");
  addIncoming(state, nextSceneId, "sequence");
}

/**
 * Automatically splits a label into consecutive scenes (e.g. "LabelName: Scene 2")
 * if the dialogue line count within the scene boundaries exceeds the specified threshold.
 * This ensures large linear label blocks are broken down into digestible nodes.
 */
function splitCurrentLabelOnSceneBoundary(
  state: ParseGraphState,
  scanState: ParseScanState,
  chapter: string,
  meta: TokenMetaFlags,
  menuDepth: number,
  sceneSplitDialogueThreshold?: number,
): void {
  const currentLabelId = scanState.currentLabelId;
  const currentLabelBaseId = scanState.currentLabelBaseId;
  const currentLabelDeclaredName = scanState.currentLabelDeclaredName;
  if (!currentLabelId || !currentLabelBaseId || !currentLabelDeclaredName) {
    return;
  }
  if (!scanState.currentLabelHasContentSinceSceneBoundary) return;
  const threshold = sceneSplitDialogueThreshold ?? 16;
  if ((scanState.currentSceneDialogueCount ?? 0) < threshold) return;

  let activeSceneId = currentLabelId;
  if (!scanState.currentLabelHasSplit) {
    const sceneOneId = toSceneLabelId(currentLabelBaseId, 1);
    remapLabelIdReferences(state, currentLabelId, sceneOneId);
    const sceneOneNode = state.nodeMap.get(sceneOneId);
    if (sceneOneNode) {
      sceneOneNode.label = `${currentLabelDeclaredName}: Scene 1`;
    }
    activeSceneId = sceneOneId;
    scanState.currentLabelId = sceneOneId;
    scanState.currentLabelHasSplit = true;
    scanState.currentLabelSceneIndex = 1;
  }

  const sceneIndex = (scanState.currentLabelSceneIndex ?? 1) + 1;
  const nextSceneId = toSceneLabelId(currentLabelBaseId, sceneIndex);
  addNode(state, {
    id: nextSceneId,
    type: "LABEL",
    label: `${currentLabelDeclaredName}: Scene ${sceneIndex}`,
    dialogueCount: 0,
    chapter,
  });

  if (scanState.pendingMenuFallthroughIds.length > 0) {
    for (const menuId of scanState.pendingMenuFallthroughIds) {
      connectSceneSplitFromSource(state, menuId, nextSceneId, "next");
    }
    scanState.pendingMenuFallthroughIds = [];
  } else {
    const activeMenu = meta.hasMenuOptionBlock
      ? menuAtDepth(scanState.menuStack, menuDepth)
      : null;
    const activeDecision = scanState
      .conditionalDecisionStack[
        scanState.conditionalDecisionStack.length - 1
      ];
    if (activeMenu) {
      connectSceneSplitFromSource(
        state,
        activeMenu.id,
        nextSceneId,
        activeMenu.optionText ?? undefined,
      );
    } else {
      let fallbackMenu: { id: string; optionText: string | null } | null = null;
      for (let index = scanState.menuStack.length - 1; index >= 0; index -= 1) {
        const menu = scanState.menuStack[index];
        if (!hasOutgoingEdge(state, menu.id)) {
          fallbackMenu = menu;
          break;
        }
      }
      if (fallbackMenu) {
        connectSceneSplitFromSource(
          state,
          fallbackMenu.id,
          nextSceneId,
          "next",
        );
      } else if (activeDecision) {
        connectSceneSplitFromSource(
          state,
          activeDecision.decisionNodeId,
          nextSceneId,
          undefined,
          createDecisionConditionMetadata(activeDecision),
        );
      } else {
        connectSceneSplitFromSource(state, activeSceneId, nextSceneId, "next");
      }
    }
  }

  state.allLabelIds.add(nextSceneId);
  scanState.currentLabelId = nextSceneId;
  scanState.currentLabelSceneIndex = sceneIndex;
  scanState.currentLabelHasContentSinceSceneBoundary = false;
  scanState.labelHasExplicitExit = false;
  scanState.currentSceneDialogueCount = 0;
}

const PYTHON_RENPY_CALL_START_PATTERN = /\brenpy\.(jump|call)\s*\(/g;
const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
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
const RECURSIVE_SCREEN_ACTION_WRAPPER_NAMES = new Set([
  "if",
  "selectedif",
  "sensitiveif",
  "showif",
]);

function isWhitespaceChar(char: string | undefined): boolean {
  return char === " " || char === "\t" || char === "\n" || char === "\r" ||
    char === "\f";
}
// Captures simple assignment statements in Python blocks:
//   1) LHS variable identifier
//   2) optional type annotation (`name: str = ...`)
//   3) single `=` assignment (not `==`)
//   4) RHS expression text up to line end
// This intentionally targets simple one-line bindings and does not attempt to
// parse complex/multiline annotations or assignment expressions.
const PYTHON_ASSIGNMENT_PATTERN_SOURCE =
  "^[ \\t]*([A-Za-z_][A-Za-z0-9_]*)(?:[ \\t]*:[^=\\n#]+)?[ \\t]*=(?!=)([^\\n]*)$";

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

  override [Symbol.matchAll](text: string): IterableIterator<RegExpMatchArray> {
    const source = this.source;
    const flags = this.flags.includes("g") ? this.flags : `${this.flags}g`;
    return (function* matchAll(
      this: TopLevelPythonAssignmentPattern,
    ): IterableIterator<RegExpMatchArray> {
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
    }).call(this);
  }
}

const PYTHON_ASSIGNMENT_PATTERN = new TopLevelPythonAssignmentPattern();

/**
 * Scans a python-like parameter or argument list enclosed in parentheses,
 * keeping track of delimiter depth and string literals, and returns the balance index.
 */
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

/**
 * Parses screen action lines (e.g. `action Jump("label")`) within a screen block.
 * Extracts call/jump targets, parameter expressions, and timeout durations for timers.
 */
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

function addDynamicTargetDiagnostic(
  state: ParseGraphState,
  chapter: string,
  construct: string,
  targetExpression: string,
  sourceId?: string,
) {
  const diagnosticId = [
    "dynamic_target",
    chapter,
    construct,
    targetExpression.trim(),
    sourceId ?? "",
  ].join("|");
  addParseDiagnostic(
    state,
    {
      code: "dynamic_target",
      severity: "warning",
      location: {
        chapter,
        construct,
        targetExpression: targetExpression.trim(),
        sourceId,
      },
      message:
        `Dynamic ${construct} target cannot be resolved statically: ${targetExpression.trim()}`,
      recoveryAction:
        "Use a static string target or configure explicit parser rules.",
    },
    diagnosticId,
  );
}

function resolveCallContext(
  scanState: ParseScanState,
  meta: TokenMetaFlags,
  menuDepth: number,
): {
  isInOption: boolean;
  source: string | null;
  optionText: string | null;
  condition?: ConditionMetadata;
} {
  const isInOption = meta.hasMenuOptionBlock;
  const menu = menuAtDepth(scanState.menuStack, menuDepth);
  const decisionContext = scanState
    .conditionalDecisionStack[scanState.conditionalDecisionStack.length - 1];
  const source = isInOption
    ? (menu ? menu.id : null)
    : (decisionContext?.decisionNodeId ?? scanState.currentLabelId);
  const condition: ConditionMetadata | undefined = decisionContext
    ? {
      branchKind: decisionContext.branchKind,
      expression: decisionContext.expression ?? undefined,
      references: decisionContext.references,
      decisionNodeId: decisionContext.decisionNodeId,
    }
    : undefined;
  return {
    isInOption,
    source,
    optionText: menu?.optionText ?? null,
    condition,
  };
}

function resolveTargetLabelId(
  state: ParseGraphState,
  targetExpression: string,
): { resolvedTargetId: string } {
  const targetName = targetExpression.trim();
  const resolvedTargetId = state.canonicalLabelIdByName.get(targetName) ??
    targetName;
  return { resolvedTargetId };
}

function emitJumpEdge(
  state: ParseGraphState,
  scanState: ParseScanState,
  target: string,
  context: {
    isInOption: boolean;
    source: string | null;
    optionText: string | null;
    condition?: ConditionMetadata;
  },
  suppressFallthrough: boolean,
  timeout?: FlowEdge["timeout"],
) {
  const { isInOption, source, optionText } = context;
  if (source) {
    const { resolvedTargetId } = resolveTargetLabelId(state, target);
    const timeoutSuffix = timeout?.isTimeout === true
      ? `_timeout_${
        timeout.durationSeconds === undefined
          ? "unknown"
          : String(timeout.durationSeconds)
      }`
      : "";
    const edgeId = `jump_${source}__${resolvedTargetId}_${
      optionText ?? ""
    }${timeoutSuffix}`;
    addEdge(state, {
      id: edgeId,
      source,
      target: resolvedTargetId,
      kind: "jump",
      label: isInOption ? (optionText ?? undefined) : undefined,
      condition: context.condition,
      timeout,
    });
    if (!isInOption && scanState.currentLabelId) {
      addOutgoing(state, scanState.currentLabelId, "jump");
      addIncoming(state, resolvedTargetId, "jump");
    } else if (isInOption) {
      // Register the menu node's outgoing jump traffic so that fallthrough
      // detection (hasOutgoingEdge) correctly skips menus whose options all
      // explicitly jump to another label.
      addOutgoing(state, source, "jump");
      addIncoming(state, resolvedTargetId, "jump");
    }
  }
  if (
    suppressFallthrough && !isInOption &&
    scanState.conditionalIndentStack.length === 0
  ) {
    scanState.labelHasExplicitExit = true;
  }
}

function emitCallEdge(
  state: ParseGraphState,
  scanState: ParseScanState,
  target: string,
  context: {
    isInOption: boolean;
    source: string | null;
    optionText: string | null;
    condition?: ConditionMetadata;
  },
  timeout?: FlowEdge["timeout"],
) {
  const { isInOption, source, optionText } = context;
  if (!source) return;
  const { resolvedTargetId } = resolveTargetLabelId(state, target);
  const timeoutSuffix = timeout?.isTimeout === true
    ? `_timeout_${
      timeout.durationSeconds === undefined
        ? "unknown"
        : String(timeout.durationSeconds)
    }`
    : "";
  const edgeId = `call_${source}__${resolvedTargetId}_${
    optionText ?? ""
  }${timeoutSuffix}`;
  addEdge(state, {
    id: edgeId,
    source,
    target: resolvedTargetId,
    kind: "call",
    label: isInOption ? (optionText ? `call: ${optionText}` : "call") : "call",
    condition: context.condition,
    timeout,
  });
  state.calledLabels.add(resolvedTargetId);
  if (!isInOption && scanState.currentLabelId) {
    addOutgoing(state, scanState.currentLabelId, "call");
    addIncoming(state, resolvedTargetId, "call");
  }
  state.pendingCallReturns.push({
    returnTargetId: source,
    callTargetId: resolvedTargetId,
  });
  if (isInOption) state.calledFromMenuOptionTargets.add(resolvedTargetId);
}

export function parseDictLiteral(
  expression: string,
): Map<string, string> | null {
  const trimmed = expression.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return null;
  const content = trimmed.substring(1, trimmed.length - 1);
  const result = new Map<string, string>();

  let i = 0;
  function skipWhitespace() {
    while (i < content.length && /\s/.test(content[i])) {
      i++;
    }
  }

  function parseStringLiteral(): string | null {
    if (i >= content.length) return null;
    const quoteChar = content[i];
    if (quoteChar !== '"' && quoteChar !== "'") return null;
    i++; // consume quote
    let str = "";
    while (i < content.length) {
      const char = content[i];
      if (char === "\\") {
        i++;
        if (i < content.length) {
          const nextChar = content[i];
          if (nextChar === "n") str += "\n";
          else if (nextChar === "t") str += "\t";
          else if (nextChar === "r") str += "\r";
          else str += nextChar;
          i++;
        }
      } else if (char === quoteChar) {
        i++; // consume closing quote
        return str;
      } else {
        str += char;
        i++;
      }
    }
    return null; // unclosed string
  }

  while (i < content.length) {
    skipWhitespace();
    if (i >= content.length) break;
    const key = parseStringLiteral();
    if (key === null) return null;

    skipWhitespace();
    if (i >= content.length || content[i] !== ":") return null;
    i++; // consume ':'

    skipWhitespace();
    const val = parseStringLiteral();
    if (val === null) return null;

    result.set(key, val);

    skipWhitespace();
    if (i < content.length) {
      if (content[i] !== ",") return null;
      i++; // consume ','
    }
  }

  return result.size > 0 ? result : null;
}

export function extractLiteralTarget(expression: string): string | null {
  const trimmed = expression.trim();
  const prefixMatch = /^(?:[rR][bB]|[bB][rR]|[rR][uU]|[uU][rR]|[rR]|[uU]|[bB])?/
    .exec(trimmed);
  const prefix = prefixMatch ? prefixMatch[0] : "";
  const rest = trimmed.substring(prefix.length);

  let quote: string;
  if (rest.startsWith('"""')) {
    quote = '"""';
  } else if (rest.startsWith("'''")) {
    quote = "'''";
  } else if (rest.startsWith('"')) {
    quote = '"';
  } else if (rest.startsWith("'")) {
    quote = "'";
  } else {
    return null;
  }

  if (!rest.endsWith(quote) || rest.length < quote.length * 2) {
    return null;
  }

  const inner = rest.substring(quote.length, rest.length - quote.length);
  const isRaw = prefix.toLowerCase().includes("r");
  let result = "";
  let i = 0;
  while (i < inner.length) {
    const char = inner[i];
    if (char === "\\" && !isRaw) {
      i++;
      if (i < inner.length) {
        const nextChar = inner[i];
        if (nextChar === "n") result += "\n";
        else if (nextChar === "t") result += "\t";
        else if (nextChar === "r") result += "\r";
        else result += nextChar;
        i++;
      } else {
        result += "\\";
      }
    } else {
      result += char;
      i++;
    }
  }

  if (result.trim().length === 0) return null;
  return result;
}

export function extractIdentifierTarget(expression: string): string | null {
  const trimmed = expression.trim();
  return IDENTIFIER_PATTERN.test(trimmed) ? trimmed : null;
}

export function resolveStaticTargetExpression(
  expression: string,
  scanState: ResolveTargetScanState,
  state?: ParseGraphState,
): string | null {
  const trimmed = expression.trim();
  const literal = extractLiteralTarget(trimmed);
  if (literal) return literal;
  const identifier = extractIdentifierTarget(trimmed);
  if (identifier) {
    const localVal = scanState.labelVariableLiteralTargets.get(identifier);
    if (localVal !== undefined) return localVal;
    if (state) {
      const globalVal = state.globalLabelVariableLiteralTargets.get(identifier);
      if (globalVal !== undefined) return globalVal;
    }
    return null;
  }

  const dictMatch = /^([A-Za-z_][A-Za-z0-9_]*)\s*\[\s*([^\]]+)\s*\]$/.exec(
    trimmed,
  );
  if (dictMatch) {
    const dictName = dictMatch[1];
    const keyExpr = dictMatch[2].trim();
    const localDict = scanState.labelVariableDictTargets.get(dictName);
    const globalDict = state?.globalLabelVariableDictTargets.get(dictName);
    const dict = localDict || globalDict;
    if (dict) {
      const resolvedKey = resolveStaticTargetExpression(
        keyExpr,
        scanState,
        state,
      );
      if (resolvedKey) {
        return dict.get(resolvedKey) ?? null;
      }
    }
  }

  return null;
}

/**
 * Resolves static targets for python or renpy jump/call expressions.
 * Tracks assignments and dictionary key mappings (e.g. `jump expression var_name`)
 * using the scanState's variable binding cache.
 */
export function resolveExpressionTargets(
  scanState: ParseScanState,
  expression: string,
  isPythonExpression: boolean,
  state?: ParseGraphState,
): string[] {
  const trimmed = expression.trim();
  const isExpr = isPythonExpression || scanState.waitForJumpExpressionTarget;

  if (isExpr) {
    const literal = extractLiteralTarget(trimmed);
    if (literal) {
      return [literal];
    }

    const identifier = extractIdentifierTarget(trimmed);
    if (identifier) {
      const localVal = scanState.labelVariableLiteralTargets.get(identifier);
      if (localVal !== undefined) {
        return [localVal];
      }
      if (state) {
        const globalVal = state.globalLabelVariableLiteralTargets.get(
          identifier,
        );
        if (globalVal !== undefined) {
          return [globalVal];
        }
      }
      return [];
    }

    const dictMatch = /^([A-Za-z_][A-Za-z0-9_]*)\s*\[\s*([^\]]+)\s*\]$/.exec(
      trimmed,
    );
    if (dictMatch) {
      const dictName = dictMatch[1];
      const keyExpr = dictMatch[2].trim();
      const localDict = scanState.labelVariableDictTargets.get(dictName);
      const globalDict = state?.globalLabelVariableDictTargets.get(dictName);
      const dict = localDict || globalDict;
      if (dict) {
        const resolvedKey = resolveStaticTargetExpression(
          keyExpr,
          scanState,
          state,
        );
        if (resolvedKey) {
          const val = dict.get(resolvedKey);
          return val ? [val] : [];
        } else {
          return Array.from(dict.values());
        }
      }
    }

    return [];
  } else {
    return [trimmed];
  }
}

type OpeningDelimiter = "(" | "[" | "{";
type ClosingDelimiter = ")" | "]" | "}";
const CLOSING_DELIMITER_BY_OPENING: Record<OpeningDelimiter, ClosingDelimiter> =
  {
    "(": ")",
    "[": "]",
    "{": "}",
  };
const CLOSING_DELIMITERS = new Set<ClosingDelimiter>([")", "]", "}"]);

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

function stripQuotes(val: string): string {
  const trimmed = val.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function extractSceneAsset(lineText: string): string | null {
  const match = lineText.match(/^\s*scene\s+(.+)$/);
  if (!match) return null;
  let content = match[1].trim();
  if (content.includes("#")) {
    content = content.split("#")[0].trim();
  }
  const paramMatch = content.match(
    /^(.*?)\s*\b(?:with|at|behind|onlayer|zorder)\b/i,
  );
  const asset = paramMatch ? paramMatch[1].trim() : content.trim();
  return stripQuotes(asset);
}

function extractPlayCue(
  lineText: string,
): { channel: string; asset: string } | null {
  const match = lineText.match(/^\s*play\s+(\w+)\s+(.+)$/);
  if (!match) return null;
  const channel = match[1].trim();
  let rest = match[2].trim();
  if (rest.includes("#")) {
    rest = rest.split("#")[0].trim();
  }
  const paramMatch = rest.match(
    /^(.*?)\s*\b(?:fadein|fadeout|loop|noloop|volume|if)\b/i,
  );
  const asset = paramMatch ? paramMatch[1].trim() : rest.trim();
  return { channel, asset: stripQuotes(asset) };
}

function extractStopCue(
  lineText: string,
): { channel: string; asset?: string } | null {
  const match = lineText.match(/^\s*stop\s+(\w+)(?:\s+(.+))?$/);
  if (!match) return null;
  const channel = match[1].trim();
  let rest = (match[2] ?? "").trim();
  if (rest.includes("#")) {
    rest = rest.split("#")[0].trim();
  }
  const paramMatch = rest.match(/^(.*?)\s*\b(?:fadeout|if)\b/i);
  const asset = paramMatch ? paramMatch[1].trim() : rest.trim();
  return { channel, asset: stripQuotes(asset) || undefined };
}

function extractQueueCue(
  lineText: string,
): { channel: string; asset: string } | null {
  const match = lineText.match(/^\s*queue\s+(\w+)\s+(.+)$/);
  if (!match) return null;
  const channel = match[1].trim();
  let rest = match[2].trim();
  if (rest.includes("#")) {
    rest = rest.split("#")[0].trim();
  }
  const paramMatch = rest.match(
    /^(.*?)\s*\b(?:fadein|fadeout|loop|noloop|volume|if)\b/i,
  );
  const asset = paramMatch ? paramMatch[1].trim() : rest.trim();
  return { channel, asset: stripQuotes(asset) };
}

function extractVoiceCue(lineText: string): string | null {
  const match = lineText.match(/^\s*voice\s+(.+)$/);
  if (!match) return null;
  let rest = match[1].trim();
  if (rest.includes("#")) {
    rest = rest.split("#")[0].trim();
  }
  const paramMatch = rest.match(/^(.*?)\s*\b(?:sustain|volume|if)\b/i);
  const asset = paramMatch ? paramMatch[1].trim() : rest.trim();
  return stripQuotes(asset);
}

// Finds the first delimiter at the current expression depth. This is used for
// top-level argument splitting/keyword parsing (`=`), dictionary payloads (`:`),
// and comma-separated argument handling.
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

interface PythonAssignmentEvent {
  kind: "assignment";
  index: number;
  variableName: string;
  assignedTarget: string | null;
  assignedDict?: Map<string, string> | null;
}

interface PythonRenpyCallEvent {
  kind: "call";
  index: number;
  callType: "jump" | "call";
  construct: "renpy.jump" | "renpy.call";
  targetExpression: string;
}

/**
 * Analyzes direct Python code blocks or inline statements (e.g., `$ renpy.jump("lbl")`)
 * to resolve variable assignments and register control flow jumps/calls.
 */
function processDirectRenpyBlockCalls(
  state: ParseGraphState,
  scanState: ParseScanState,
  meta: TokenMetaFlags,
  chapter: string,
  menuDepth: number,
  blockText: string,
) {
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
    events.push({
      kind: "assignment",
      index: match.index,
      variableName,
      assignedTarget,
      assignedDict,
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
      } else if (event.assignedDict) {
        scanState.labelVariableDictTargets.set(
          event.variableName,
          event.assignedDict,
        );
        scanState.labelVariableLiteralTargets.delete(event.variableName);
      } else {
        scanState.labelVariableLiteralTargets.delete(event.variableName);
        scanState.labelVariableDictTargets.delete(event.variableName);
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
function processDirectScreenActionCalls(
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
function resetStaleWaitFlags(scanState: ParseScanState, type: number): void {
  // Wait flags are transient parser intents (e.g. "next function-name is a jump target").
  // On malformed or mixed token streams, these intents can leak into later tokens and create
  // false edges; this guard clears stale waits when token context no longer matches.
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

function resolveConditionalSource(
  scanState: ParseScanState,
  meta: TokenMetaFlags,
  menuDepth: number,
): string | null {
  if (meta.hasMenuOptionBlock) {
    const menu = menuAtDepth(scanState.menuStack, menuDepth);
    return menu?.id ?? scanState.currentLabelId;
  }
  return scanState.currentLabelId;
}

/**
 * Processes conditional keyword transitions (if, elif, else), creating
 * a decision node in the graph and managing the conditional decision stack.
 */
function handleConditionalHeader(
  state: ParseGraphState,
  scanState: ParseScanState,
  meta: TokenMetaFlags,
  menuDepth: number,
  chapter: string,
): boolean {
  const pending = scanState.pendingConditionalHeader;
  if (!pending || scanState.currentLabelId === null) return false;
  const source = resolveConditionalSource(scanState, meta, menuDepth);
  if (!source) return false;
  if (pending.kind === "if") {
    state.decisionCounter += 1;
    const decisionNodeId = `decision_${state.decisionCounter}`;
    const references = extractConditionFlagRefs(
      pending.expression ?? undefined,
    );
    addNode(state, {
      id: decisionNodeId,
      type: "DECISION",
      label: pending.expression ? `if ${pending.expression}` : "if",
      dialogueCount: 0,
      chapter,
      parentLabelId: scanState.currentLabelId ?? undefined,
      condition: {
        branchKind: "if",
        expression: pending.expression ?? undefined,
        references,
        decisionNodeId,
      },
    });
    addEdge(state, {
      id: `seq_${source}__${decisionNodeId}`,
      source,
      target: decisionNodeId,
      kind: "sequence",
      label: "if",
    });
    addOutgoing(state, source, "sequence");
    addIncoming(state, decisionNodeId, "sequence");
    scanState.conditionalDecisionStack.push({
      indent: pending.indent,
      decisionNodeId,
      sourceId: source,
      branchKind: "if",
      expression: pending.expression,
      references,
    });
    scanState.pendingConditionalHeader = null;
    return true;
  }
  const existing = scanState
    .conditionalDecisionStack[scanState.conditionalDecisionStack.length - 1];
  if (!existing || existing.indent !== pending.indent) {
    scanState.pendingConditionalHeader = null;
    return false;
  }
  existing.branchKind = pending.kind;
  existing.expression = pending.expression;
  existing.references = extractConditionFlagRefs(
    pending.expression ?? undefined,
  );
  scanState.pendingConditionalHeader = null;
  return true;
}

export function ensureScanStateInitialized(scanState: ParseScanState): void {
  if (!scanState.conditionalDecisionStack) {
    scanState.conditionalDecisionStack = [];
  }
  if (!scanState.labelVariableLiteralTargets) {
    scanState.labelVariableLiteralTargets = new Map();
  }
  if (!scanState.labelVariableDictTargets) {
    scanState.labelVariableDictTargets = new Map();
  }
  if (scanState.pendingConditionalHeader === undefined) {
    scanState.pendingConditionalHeader = null;
  }
  if (scanState.currentLabelDeclaredName === undefined) {
    scanState.currentLabelDeclaredName = null;
  }
  if (scanState.currentLabelBaseId === undefined) {
    scanState.currentLabelBaseId = null;
  }
  if (scanState.currentLabelSceneIndex === undefined) {
    scanState.currentLabelSceneIndex = 1;
  }
  if (scanState.currentLabelHasSplit === undefined) {
    scanState.currentLabelHasSplit = false;
  }
  if (scanState.currentLabelHasContentSinceSceneBoundary === undefined) {
    scanState.currentLabelHasContentSinceSceneBoundary = false;
  }
}

/**
 * The main dispatch router for individual tokens in the parser pipeline.
 * Evaluates token types (labels, jumps, calls, returns, menus, dialogue strings)
 * and mutates the flowchart graph topology accordingly.
 *
 * @param state Global graph assembly accumulator.
 * @param scanState File-local scanning track.
 * @param input Evaluated token data.
 */
export function handleToken(
  state: ParseGraphState,
  scanState: ParseScanState,
  input: HandleTokenInput,
): void {
  if (
    !scanState.labelVariableDictTargets || !scanState.conditionalDecisionStack
  ) {
    ensureScanStateInitialized(scanState);
  }
  const {
    type,
    meta,
    val,
    chapter,
    menuDepth,
    lineIndent,
    lineText,
    captureDialogueLines,
    screenActionRuleMap,
  } = input;
  resetStaleWaitFlags(scanState, type);

  if (type === PARSER_TOKENS.kwLabel && meta.hasLabelStatement) {
    scanState.waitForLabelName = true;
    scanState.pendingMenuFallthroughIds = [];
    for (const openMenu of scanState.menuStack) {
      if (!hasOutgoingEdge(state, openMenu.id)) {
        scanState.pendingMenuFallthroughIds.push(openMenu.id);
      }
    }
    scanState.menuStack.length = 0;
    scanState.conditionalIndentStack.length = 0;
    scanState.conditionalDecisionStack.length = 0;
    scanState.pendingConditionalHeader = null;
    scanState.waitForJumpTarget = false;
    scanState.waitForJumpExpressionTarget = false;
    scanState.waitForCallTarget = false;
    scanState.waitForMenuNameForId = null;
    return;
  }

  if (
    type === PARSER_TOKENS.entityFunctionName &&
    scanState.waitForLabelName &&
    meta.hasLabelStatement
  ) {
    const declaredLabelName = val().trim();
    const definitionCount =
      (state.labelDefinitionCountByName.get(declaredLabelName) ?? 0) + 1;
    state.labelDefinitionCountByName.set(declaredLabelName, definitionCount);
    const canonicalLabelId =
      state.canonicalLabelIdByName.get(declaredLabelName) ?? declaredLabelName;
    state.canonicalLabelIdByName.set(declaredLabelName, canonicalLabelId);
    const newLabelId = definitionCount === 1
      ? canonicalLabelId
      : `${canonicalLabelId}__shadow_${definitionCount}`;
    if (
      scanState.currentLabelId !== null &&
      !scanState.labelHasExplicitExit &&
      scanState.menuStack.length === 0
    ) {
      addEdge(state, {
        id: `seq_${scanState.currentLabelId}__${newLabelId}`,
        source: scanState.currentLabelId,
        target: newLabelId,
        kind: "sequence",
        label: "next",
      });
      addOutgoing(state, scanState.currentLabelId, "sequence");
      addIncoming(state, newLabelId, "sequence");
    }

    scanState.currentLabelId = newLabelId;
    scanState.currentLabelBaseId = newLabelId;
    scanState.currentLabelDeclaredName = declaredLabelName;
    scanState.currentLabelSceneIndex = 1;
    scanState.currentLabelHasSplit = false;
    scanState.currentLabelHasContentSinceSceneBoundary = false;
    scanState.currentLabelIndent = lineIndent;
    scanState.currentSceneDialogueCount = 0;
    scanState.labelVariableLiteralTargets.clear();
    scanState.labelVariableDictTargets.clear();
    for (const menuId of scanState.pendingMenuFallthroughIds) {
      addEdge(state, {
        id: `seq_${menuId}__${newLabelId}`,
        source: menuId,
        target: newLabelId,
        kind: "sequence",
        label: "next",
      });
      addOutgoing(state, menuId, "sequence");
      addIncoming(state, newLabelId, "sequence");
    }
    scanState.pendingMenuFallthroughIds = [];
    state.allLabelIds.add(newLabelId);
    scanState.labelHasExplicitExit = false;
    scanState.waitForLabelName = false;

    addNode(state, {
      id: newLabelId,
      type: "LABEL",
      label: declaredLabelName,
      dialogueCount: 0,
      chapter,
      isShadowed: definitionCount > 1,
      shadowOfId: definitionCount > 1 ? canonicalLabelId : undefined,
    });
    if (definitionCount > 1) {
      const diagnosticId =
        `shadowed_label|${chapter}|${declaredLabelName}|${newLabelId}|${canonicalLabelId}`;
      addParseDiagnostic(
        state,
        {
          code: "shadowed_label",
          severity: "warning",
          location: {
            chapter,
            construct: "label",
            sourceId: newLabelId,
            targetId: canonicalLabelId,
          },
          context: {
            category: "shadowed_label",
            detail: declaredLabelName,
          },
          message:
            `Label "${declaredLabelName}" is a duplicate definition and is shadowed by canonical label "${canonicalLabelId}".`,
          recoveryAction:
            "Rename duplicate labels or keep one canonical definition.",
        },
        diagnosticId,
      );
    }
    return;
  }

  if (!isWithinCurrentLabelScope(scanState, meta, lineIndent)) {
    return;
  }

  if (PARSER_TOKENS.kwScene !== undefined && type === PARSER_TOKENS.kwScene) {
    splitCurrentLabelOnSceneBoundary(
      state,
      scanState,
      chapter,
      meta,
      menuDepth,
      input.sceneSplitDialogueThreshold,
    );
    if (scanState.currentLabelId) {
      const ownerNode = state.nodeMap.get(scanState.currentLabelId);
      if (ownerNode) {
        const sceneAsset = extractSceneAsset(lineText);
        if (sceneAsset) {
          if (!ownerNode.audioAssetCues) ownerNode.audioAssetCues = [];
          ownerNode.audioAssetCues.push({
            type: "scene",
            asset: sceneAsset,
            raw: lineText.trim(),
          });
        }
      }
    }
    return;
  }

  if (PARSER_TOKENS.kwPlay !== undefined && type === PARSER_TOKENS.kwPlay) {
    scanState.currentLabelHasContentSinceSceneBoundary = true;
    if (scanState.currentLabelId) {
      const ownerNode = state.nodeMap.get(scanState.currentLabelId);
      if (ownerNode) {
        const cue = extractPlayCue(lineText);
        if (cue) {
          if (!ownerNode.audioAssetCues) ownerNode.audioAssetCues = [];
          ownerNode.audioAssetCues.push({
            type: "play",
            channel: cue.channel,
            asset: cue.asset,
            raw: lineText.trim(),
          });
        }
      }
    }
    return;
  }

  if (PARSER_TOKENS.kwStop !== undefined && type === PARSER_TOKENS.kwStop) {
    scanState.currentLabelHasContentSinceSceneBoundary = true;
    if (scanState.currentLabelId) {
      const ownerNode = state.nodeMap.get(scanState.currentLabelId);
      if (ownerNode) {
        const cue = extractStopCue(lineText);
        if (cue) {
          if (!ownerNode.audioAssetCues) ownerNode.audioAssetCues = [];
          ownerNode.audioAssetCues.push({
            type: "stop",
            channel: cue.channel,
            asset: cue.asset ?? "",
            raw: lineText.trim(),
          });
        }
      }
    }
    return;
  }

  if (PARSER_TOKENS.kwQueue !== undefined && type === PARSER_TOKENS.kwQueue) {
    scanState.currentLabelHasContentSinceSceneBoundary = true;
    if (scanState.currentLabelId) {
      const ownerNode = state.nodeMap.get(scanState.currentLabelId);
      if (ownerNode) {
        const cue = extractQueueCue(lineText);
        if (cue) {
          if (!ownerNode.audioAssetCues) ownerNode.audioAssetCues = [];
          ownerNode.audioAssetCues.push({
            type: "queue",
            channel: cue.channel,
            asset: cue.asset,
            raw: lineText.trim(),
          });
        }
      }
    }
    return;
  }

  const isVoiceToken =
    (PARSER_TOKENS.kwVoice !== undefined && type === PARSER_TOKENS.kwVoice) ||
    (PARSER_TOKENS.kwOther !== undefined && type === PARSER_TOKENS.kwOther &&
      val().trim().toLowerCase() === "voice");

  if (isVoiceToken) {
    scanState.currentLabelHasContentSinceSceneBoundary = true;
    if (scanState.currentLabelId) {
      const ownerNode = state.nodeMap.get(scanState.currentLabelId);
      if (ownerNode) {
        const voiceAsset = extractVoiceCue(lineText);
        if (voiceAsset) {
          if (!ownerNode.audioAssetCues) ownerNode.audioAssetCues = [];
          ownerNode.audioAssetCues.push({
            type: "voice",
            asset: voiceAsset,
            raw: lineText.trim(),
          });
        }
      }
    }
    return;
  }

  if (type === PARSER_TOKENS.kwConditional) {
    if (handleConditionalHeader(state, scanState, meta, menuDepth, chapter)) {
      scanState.currentLabelHasContentSinceSceneBoundary = true;
    }
  }

  if (
    PARSER_TOKENS.kwDollarSign !== undefined &&
    type === PARSER_TOKENS.kwDollarSign
  ) {
    scanState.currentLabelHasContentSinceSceneBoundary = true;
    const rawText = lineText.trim();
    const cleanStmt = rawText.startsWith("$")
      ? rawText.slice(1).trim()
      : rawText;
    processDirectRenpyBlockCalls(
      state,
      scanState,
      meta,
      chapter,
      menuDepth,
      cleanStmt,
    );
    return;
  }

  if (type === PARSER_TOKENS.metaPythonBlock) {
    scanState.currentLabelHasContentSinceSceneBoundary = true;
    processDirectRenpyBlockCalls(
      state,
      scanState,
      meta,
      chapter,
      menuDepth,
      val(),
    );
    return;
  }

  if (type === PARSER_TOKENS.metaScreenBlock) {
    scanState.currentLabelHasContentSinceSceneBoundary = true;
    processDirectScreenActionCalls(
      state,
      scanState,
      meta,
      chapter,
      menuDepth,
      val(),
      screenActionRuleMap,
    );
    return;
  }

  if (scanState.currentLabelId === null) return;

  if (isMenuKeywordTokenType(type) && meta.hasMenuStatement) {
    scanState.currentLabelHasContentSinceSceneBoundary = true;
    const poppedMenus: Array<{ id: string; optionText: string | null }> = [];
    while (scanState.menuStack.length > parentMenuStackLength(menuDepth)) {
      const closedMenu = scanState.menuStack.pop();
      if (closedMenu) poppedMenus.push(closedMenu);
    }

    state.menuCounter += 1;
    const newMenuId = `menu_${state.menuCounter}`;
    scanState.waitForMenuNameForId = newMenuId;
    addNode(state, {
      id: newMenuId,
      type: "MENU",
      label: newMenuId,
      dialogueCount: 0,
      chapter,
      parentLabelId: scanState.currentLabelId,
    });
    for (const closedMenu of poppedMenus) {
      if (hasOutgoingEdge(state, closedMenu.id)) continue;
      addEdge(state, {
        id: `seq_${closedMenu.id}__${newMenuId}`,
        source: closedMenu.id,
        target: newMenuId,
        kind: "sequence",
        label: "next",
      });
      addOutgoing(state, closedMenu.id, "sequence");
      addIncoming(state, newMenuId, "sequence");
    }

    const parentMenu = scanState.menuStack[scanState.menuStack.length - 1];
    const decisionContext = scanState
      .conditionalDecisionStack[
        scanState.conditionalDecisionStack.length - 1
      ];
    const source = parentMenu
      ? parentMenu.id
      : (decisionContext?.decisionNodeId ?? scanState.currentLabelId);
    if (source) {
      addEdge(state, {
        id: edgeIdWithOption(
          `seq_${source}__${newMenuId}`,
          parentMenu?.optionText,
        ),
        source,
        target: newMenuId,
        kind: "sequence",
        label: parentMenu?.optionText ?? undefined,
        condition: decisionContext
          ? {
            branchKind: decisionContext.branchKind,
            expression: decisionContext.expression ?? undefined,
            references: decisionContext.references,
            decisionNodeId: decisionContext.decisionNodeId,
          }
          : undefined,
      });
      addOutgoing(state, source, "sequence");
      addIncoming(state, newMenuId, "sequence");
    }

    scanState.menuStack.push({ id: newMenuId, optionText: null });
    assertInvariant(
      scanState.menuStack.length <= menuDepth,
      `menu stack depth exceeded menu meta depth (${scanState.menuStack.length} > ${menuDepth})`,
    );

    if (scanState.conditionalIndentStack.length === 0) {
      scanState.labelHasExplicitExit = true;
    }
    return;
  }

  if (
    type === PARSER_TOKENS.entityFunctionName &&
    scanState.waitForMenuNameForId !== null &&
    meta.hasMenuStatement &&
    !meta.hasMenuBlock
  ) {
    const menuLabel = val();
    const existing = state.nodeMap.get(scanState.waitForMenuNameForId);
    if (existing) existing.label = menuLabel;
    scanState.waitForMenuNameForId = null;
    return;
  }

  if (
    type === PARSER_TOKENS.literalString &&
    meta.hasMenuOption &&
    meta.hasMenuBlock
  ) {
    const menu = menuAtDepth(scanState.menuStack, menuDepth);
    if (menu) menu.optionText = val();
    return;
  }

  if (PARSER_TOKENS.kwScreen !== undefined && type === PARSER_TOKENS.kwScreen) {
    scanState.waitForCallTarget = false;
    scanState.waitForJumpTarget = false;
    return;
  }

  if (type === PARSER_TOKENS.kwJump && meta.hasJumpStatement) {
    scanState.currentLabelHasContentSinceSceneBoundary = true;
    scanState.waitForJumpTarget = true;
    scanState.waitForJumpExpressionTarget = false;
    return;
  }

  const isJumpTargetToken = type === PARSER_TOKENS.entityFunctionName ||
    (PARSER_TOKENS.entityIdentifier !== undefined &&
      type === PARSER_TOKENS.entityIdentifier) ||
    (PARSER_TOKENS.metaItemAccess !== undefined &&
      type === PARSER_TOKENS.metaItemAccess) ||
    (PARSER_TOKENS.metaFunctionCall !== undefined &&
      type === PARSER_TOKENS.metaFunctionCall);

  if (
    isJumpTargetToken &&
    scanState.waitForJumpTarget &&
    meta.hasJumpStatement
  ) {
    const targetExpression = val();
    const targets = resolveExpressionTargets(
      scanState,
      targetExpression,
      false,
      state,
    );
    const context = resolveCallContext(scanState, meta, menuDepth);
    if (targets.length === 0) {
      addDynamicTargetDiagnostic(
        state,
        chapter,
        "jump expression",
        targetExpression,
        context.source ?? undefined,
      );
      const isReliableJumpExit =
        scanState.conditionalIndentStack.length === 0 &&
        !meta.hasMenuOptionBlock;
      if (isReliableJumpExit) {
        scanState.labelHasExplicitExit = true;
      }
      scanState.waitForJumpTarget = false;
      scanState.waitForJumpExpressionTarget = false;
      return;
    }
    for (const target of targets) {
      emitJumpEdge(state, scanState, target, context, true);
    }
    scanState.waitForJumpTarget = false;
    scanState.waitForJumpExpressionTarget = false;
    return;
  }

  if (type === PARSER_TOKENS.kwCall && meta.hasCallStatement) {
    scanState.currentLabelHasContentSinceSceneBoundary = true;
    scanState.waitForCallTarget = true;
    return;
  }

  if (
    type === PARSER_TOKENS.entityFunctionName &&
    scanState.waitForCallTarget &&
    meta.hasCallStatement
  ) {
    const target = val();
    const context = resolveCallContext(scanState, meta, menuDepth);
    emitCallEdge(state, scanState, target, context);

    scanState.waitForCallTarget = false;
    return;
  }

  if (type === PARSER_TOKENS.kwReturn && !meta.hasMenuOptionBlock) {
    scanState.currentLabelHasContentSinceSceneBoundary = true;
    const isReliableReturn = scanState.conditionalIndentStack.length === 0;
    if (isReliableReturn && scanState.currentLabelId !== null) {
      scanState.labelHasExplicitExit = true;
      state.hasReliableReturnInLabel.add(scanState.currentLabelId);
    }
    if (scanState.currentLabelId !== null) {
      state.hasReturnInLabel.add(scanState.currentLabelId);
    }
    return;
  }

  if (type === PARSER_TOKENS.literalString) {
    const isSay = meta.hasSayNarrator ||
      meta.hasSayCharacter ||
      meta.hasSayStatement;
    const isMenuOption = meta.hasMenuOption;

    if (isSay && !isMenuOption) {
      scanState.currentLabelHasContentSinceSceneBoundary = true;
      scanState.currentSceneDialogueCount =
        (scanState.currentSceneDialogueCount ?? 0) + 1;
      const menu = menuAtDepth(scanState.menuStack, menuDepth);
      const ownerId = meta.hasMenuOptionBlock && menu
        ? menu.id
        : scanState.currentLabelId;

      if (ownerId) {
        const ownerNode = state.nodeMap.get(ownerId);
        if (ownerNode) {
          ownerNode.dialogueCount += 1;
          if (captureDialogueLines) {
            const line = val();
            if (!ownerNode.dialogueLines) ownerNode.dialogueLines = [];
            ownerNode.dialogueLines.push(line);
          }
        }
      }
    }
  }
}
