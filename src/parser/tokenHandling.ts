import { PARSER_TOKENS, isMenuKeywordTokenType } from '../parserTokens';
import type { ParseGraphState, ParseScanState, TokenMetaFlags } from './pipelineTypes';
import { menuAtDepth, parentMenuStackLength, edgeIdWithOption } from './scanTransitions';
import { addNode, addEdge, addIncoming, addOutgoing } from './graphMutations';
import { assertInvariant } from './pipelineInvariants';
import type { ScreenActionKind } from '../config/parserRules';
import { addParseDiagnostic } from './diagnostics';
import { extractConditionFlagRefs } from '../conditionLogic';
import type { ConditionMetadata } from '../domain';

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
}

function hasOutgoingEdge(state: ParseGraphState, sourceId: string): boolean {
  return state.outgoingByLabel.has(sourceId);
}

function isWithinCurrentLabelScope(scanState: ParseScanState, meta: TokenMetaFlags, lineIndent: number): boolean {
  if (meta.hasLabelStatement) {
    return true;
  }
  if (scanState.currentLabelId === null || scanState.currentLabelIndent === null) {
    return false;
  }
  return lineIndent > scanState.currentLabelIndent;
}

const LABEL_SCENE_ID_SEPARATOR = '__scene_';

function toSceneLabelId(baseLabelId: string, sceneIndex: number): string {
  return `${baseLabelId}${LABEL_SCENE_ID_SEPARATOR}${sceneIndex}`;
}

function replaceSetEntry(set: Set<string>, fromId: string, toId: string): void {
  if (!set.delete(fromId)) return;
  set.add(toId);
}

function remapMapKey<T>(map: Map<string, T>, fromId: string, toId: string): void {
  if (!map.has(fromId)) return;
  const value = map.get(fromId) as T;
  map.delete(fromId);
  map.set(toId, value);
}

function rebuildGraphFromState(state: ParseGraphState): void {
  state.graph.clear();
  state.pendingGraphEdgeIds.clear();

  for (const node of state.nodes) {
    if (!state.graph.hasNode(node.id)) {
      state.graph.addNode(node.id, node);
    }
  }
  for (const edge of state.edges) {
    if (state.graph.hasNode(edge.source) && state.graph.hasNode(edge.target)) {
      if (!state.graph.hasEdge(edge.id)) {
        state.graph.addDirectedEdgeWithKey(edge.id, edge.source, edge.target, edge);
      }
    } else {
      state.pendingGraphEdgeIds.add(edge.id);
    }
  }
}

function remapLabelIdReferences(state: ParseGraphState, fromId: string, toId: string): void {
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
    if (pendingCallReturn.returnTargetId === fromId) pendingCallReturn.returnTargetId = toId;
    if (pendingCallReturn.callTargetId === fromId) pendingCallReturn.callTargetId = toId;
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
  for (const [labelName, canonicalLabelId] of state.canonicalLabelIdByName.entries()) {
    if (canonicalLabelId === fromId) {
      state.canonicalLabelIdByName.set(labelName, toId);
    }
  }
  rebuildGraphFromState(state);
}

function createDecisionConditionMetadata(
  decisionContext: ParseScanState['conditionalDecisionStack'][number] | undefined,
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
    kind: 'sequence',
    label,
    condition,
  });
  addOutgoing(state, sourceId, 'sequence');
  addIncoming(state, nextSceneId, 'sequence');
}

function splitCurrentLabelOnSceneBoundary(
  state: ParseGraphState,
  scanState: ParseScanState,
  chapter: string,
): void {
  const currentLabelId = scanState.currentLabelId;
  const currentLabelBaseId = scanState.currentLabelBaseId;
  const currentLabelDeclaredName = scanState.currentLabelDeclaredName;
  if (!currentLabelId || !currentLabelBaseId || !currentLabelDeclaredName) return;
  if (!scanState.currentLabelHasContentSinceSceneBoundary) return;

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
    type: 'LABEL',
    label: `${currentLabelDeclaredName}: Scene ${sceneIndex}`,
    dialogueCount: 0,
    chapter,
  });

  if (scanState.pendingMenuFallthroughIds.length > 0) {
    for (const menuId of scanState.pendingMenuFallthroughIds) {
      connectSceneSplitFromSource(state, menuId, nextSceneId, 'next');
    }
    scanState.pendingMenuFallthroughIds = [];
  } else {
    const activeMenu = scanState.menuStack[scanState.menuStack.length - 1];
    const activeDecision = scanState.conditionalDecisionStack[scanState.conditionalDecisionStack.length - 1];
    if (activeMenu) {
      connectSceneSplitFromSource(state, activeMenu.id, nextSceneId, activeMenu.optionText ?? undefined);
    } else if (activeDecision) {
      connectSceneSplitFromSource(
        state,
        activeDecision.decisionNodeId,
        nextSceneId,
        undefined,
        createDecisionConditionMetadata(activeDecision),
      );
    } else {
      connectSceneSplitFromSource(state, activeSceneId, nextSceneId, 'next');
    }
  }

  state.allLabelIds.add(nextSceneId);
  scanState.currentLabelId = nextSceneId;
  scanState.currentLabelSceneIndex = sceneIndex;
  scanState.currentLabelHasContentSinceSceneBoundary = false;
  scanState.labelHasExplicitExit = false;
}

const QUOTED_LITERAL_PATTERN = /^(?:[rR]|[uU]|[bB]|[rR][bB]|[bB][rR])?(?:("""|'''|"|')([\s\S]*?)\1)$/;
const PYTHON_RENPY_CALL_START_PATTERN = /\brenpy\.(jump|call)\s*\(/g;
const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const IDENTIFIER_START_PATTERN = /[A-Za-z_]/;
const IDENTIFIER_PART_PATTERN = /[A-Za-z0-9_.]/;
const RECURSIVE_SCREEN_ACTION_WRAPPER_NAMES = new Set([
  'if',
  'selectedif',
  'sensitiveif',
  'showif',
]);

function isWhitespaceChar(char: string | undefined): boolean {
  return char === ' ' || char === '\t' || char === '\n' || char === '\r' || char === '\f';
}
// Captures simple assignment statements in Python blocks:
//   1) LHS variable identifier
//   2) optional type annotation (`name: str = ...`)
//   3) single `=` assignment (not `==`)
//   4) RHS expression text up to line end
// This intentionally targets simple one-line bindings and does not attempt to
// parse complex/multiline annotations or assignment expressions.
const PYTHON_ASSIGNMENT_PATTERN_SOURCE = '^[ \\t]*([A-Za-z_][A-Za-z0-9_]*)(?:[ \\t]*:[^=\\n#]+)?[ \\t]*=(?!=)([^\\n]*)$';

function isTopLevelPythonStatementMatch(text: string, matchIndex: number): boolean {
  let parenDepth = 0;
  let bracketDepth = 0;
  let braceDepth = 0;
  let activeQuote: '"' | '\'' | null = null;
  let tripleQuoted = false;
  let index = 0;

  while (index < matchIndex) {
    const char = text[index];
    if (activeQuote) {
      if (tripleQuoted) {
        if (char === activeQuote && text[index + 1] === activeQuote && text[index + 2] === activeQuote) {
          index += 3;
          activeQuote = null;
          tripleQuoted = false;
        } else {
          index += 1;
        }
        continue;
      }
      if (char === '\\') {
        const escapeSequenceLength = (index + 1 < text.length) ? 2 : 1;
        index += escapeSequenceLength;
        continue;
      }
      if (char === activeQuote) {
        activeQuote = null;
      }
      index += 1;
      continue;
    }

    if (char === '#') {
      while (index < matchIndex && text[index] !== '\n') {
        index += 1;
      }
      continue;
    }

    if ((char === '"' || char === '\'') && text[index + 1] === char && text[index + 2] === char) {
      activeQuote = char;
      tripleQuoted = true;
      index += 3;
      continue;
    }
    if (char === '"' || char === '\'') {
      activeQuote = char;
      tripleQuoted = false;
      index += 1;
      continue;
    }

    if (char === '(') {
      parenDepth += 1;
    } else if (char === ')') {
      parenDepth = Math.max(0, parenDepth - 1);
    } else if (char === '[') {
      bracketDepth += 1;
    } else if (char === ']') {
      bracketDepth = Math.max(0, bracketDepth - 1);
    } else if (char === '{') {
      braceDepth += 1;
    } else if (char === '}') {
      braceDepth = Math.max(0, braceDepth - 1);
    }

    index += 1;
  }

  return parenDepth === 0 && bracketDepth === 0 && braceDepth === 0;
}

class TopLevelPythonAssignmentPattern extends RegExp {
  constructor() {
    super(PYTHON_ASSIGNMENT_PATTERN_SOURCE, 'gm');
  }

  override exec(text: string): RegExpExecArray | null {
    const matcher = new RegExp(this.source, this.flags);
    matcher.lastIndex = this.lastIndex;

    let match: RegExpExecArray | null;
    while ((match = matcher.exec(text)) !== null) {
      this.lastIndex = matcher.lastIndex;
      if (match.index !== undefined && isTopLevelPythonStatementMatch(text, match.index)) {
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
    const flags = this.flags.includes('g') ? this.flags : `${this.flags}g`;
    return (function* matchAll(this: TopLevelPythonAssignmentPattern): IterableIterator<RegExpMatchArray> {
      const matcher = new RegExp(source, flags);
      let match: RegExpExecArray | null;
      while ((match = matcher.exec(text)) !== null) {
        this.lastIndex = matcher.lastIndex;
        if (match.index !== undefined && isTopLevelPythonStatementMatch(text, match.index)) {
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

function readParenthesizedArgument(
  text: string,
  argumentStartIndex: number,
): { argument: string; endIndex: number } | null {
  let depth = 1;
  let index = argumentStartIndex;
  let activeQuote: '"' | '\'' | null = null;
  let tripleQuoted = false;

  while (index < text.length) {
    const char = text[index];
    if (activeQuote) {
      if (tripleQuoted) {
        if (char === activeQuote && text[index + 1] === activeQuote && text[index + 2] === activeQuote) {
          index += 3;
          activeQuote = null;
          tripleQuoted = false;
        } else {
          index += 1;
        }
        continue;
      }
      if (char === '\\') {
        index += (index + 1 < text.length) ? 2 : 1;
        continue;
      }
      if (char === activeQuote) {
        activeQuote = null;
      }
      index += 1;
      continue;
    }

    if ((char === '"' || char === '\'') && text[index + 1] === char && text[index + 2] === char) {
      activeQuote = char;
      tripleQuoted = true;
      index += 3;
      continue;
    }
    if (char === '"' || char === '\'') {
      activeQuote = char;
      index += 1;
      continue;
    }

    if (char === '(') {
      depth += 1;
      index += 1;
      continue;
    }
    if (char === ')') {
      depth -= 1;
      if (depth === 0) {
        return {
          argument: text.slice(argumentStartIndex, index),
          endIndex: index + 1,
        };
      }
      index += 1;
      continue;
    }

    index += 1;
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
    '(': ')',
    '[': ']',
    '{': '}',
  };
  const expectedCloser = closingByOpening[opener ?? ''];
  if (!expectedCloser) return null;

  const stack = [expectedCloser];
  let index = startIndex + 1;
  let activeQuote: '"' | '\'' | null = null;
  let tripleQuoted = false;
  let inComment = false;

  while (index < text.length) {
    const char = text[index];
    if (inComment) {
      if (char === '\n') inComment = false;
      index += 1;
      continue;
    }

    if (activeQuote) {
      if (tripleQuoted) {
        if (char === activeQuote && text[index + 1] === activeQuote && text[index + 2] === activeQuote) {
          index += 3;
          activeQuote = null;
          tripleQuoted = false;
        } else {
          index += 1;
        }
        continue;
      }
      if (char === '\\') {
        const escapeSequenceLength = (index + 1 < text.length) ? 2 : 1;
        index += escapeSequenceLength;
        continue;
      }
      if (char === activeQuote) activeQuote = null;
      index += 1;
      continue;
    }

    if (char === '#') {
      inComment = true;
      index += 1;
      continue;
    }

    if ((char === '"' || char === '\'') && text[index + 1] === char && text[index + 2] === char) {
      activeQuote = char;
      tripleQuoted = true;
      index += 3;
      continue;
    }
    if (char === '"' || char === '\'') {
      activeQuote = char;
      index += 1;
      continue;
    }

    if (char === '(' || char === '[' || char === '{') {
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

  if (firstChar === '(' || firstChar === '[' || firstChar === '{') {
    return readBalancedSegment(text, expressionStart);
  }

  if (!IDENTIFIER_START_PATTERN.test(firstChar ?? '')) {
    return null;
  }

  let identifierEnd = expressionStart + 1;
  while (identifierEnd < text.length && IDENTIFIER_PART_PATTERN.test(text[identifierEnd] ?? '')) {
    identifierEnd += 1;
  }
  const afterIdentifier = skipWhitespace(text, identifierEnd);
  if (text[afterIdentifier] !== '(') {
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
  return !char || !/[A-Za-z0-9_]/.test(char);
}

function readIdentifier(text: string, startIndex: number): { identifier: string; endIndex: number } | null {
  if (!IDENTIFIER_START_PATTERN.test(text[startIndex] ?? '')) return null;
  let endIndex = startIndex + 1;
  while (endIndex < text.length && IDENTIFIER_PART_PATTERN.test(text[endIndex] ?? '')) {
    endIndex += 1;
  }
  return {
    identifier: text.slice(startIndex, endIndex),
    endIndex,
  };
}

function allowsActionExtractionOnLine(keyword: string): boolean {
  return keyword.toLowerCase() !== 'default';
}

function extractScreenActionExpressions(blockText: string): string[] {
  const ignoredMask = buildIgnoredPositionMask(blockText);
  const expressions: string[] = [];
  let currentLineFirstTopLevelIdentifier: string | null = null;

  for (let index = 0; index < blockText.length; index += 1) {
    if (blockText[index] === '\n') {
      currentLineFirstTopLevelIdentifier = null;
      continue;
    }
    if (ignoredMask[index]) continue;
    const identifier = readIdentifier(blockText, index);
    if (!identifier) continue;
    if (!currentLineFirstTopLevelIdentifier) {
      currentLineFirstTopLevelIdentifier = identifier.identifier;
    }
    if (
      identifier.identifier === 'action'
      && allowsActionExtractionOnLine(currentLineFirstTopLevelIdentifier)
      && isIdentifierBoundary(blockText[index - 1])
      && isIdentifierBoundary(blockText[identifier.endIndex])
    ) {
      let cursor = identifier.endIndex;
      if (!/\s|=/.test(blockText[cursor] ?? '')) {
        index = identifier.endIndex - 1;
        continue;
      }
      cursor = skipWhitespace(blockText, cursor);
      if (blockText[cursor] === '=') {
        cursor = skipWhitespace(blockText, cursor + 1);
      }

      const parsed = readScreenActionExpression(blockText, cursor);
      if (parsed) {
        expressions.push(parsed.expression);
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
    'dynamic_target',
    chapter,
    construct,
    targetExpression.trim(),
    sourceId ?? '',
  ].join('|');
  addParseDiagnostic(
    state,
    {
      code: 'dynamic_target',
      severity: 'warning',
      location: {
        chapter,
        construct,
        targetExpression: targetExpression.trim(),
        sourceId,
      },
      message: `Dynamic ${construct} target cannot be resolved statically: ${targetExpression.trim()}`,
      recoveryAction: 'Use a static string target or configure explicit parser rules.',
    },
    diagnosticId,
  );
}

function resolveCallContext(
  scanState: ParseScanState,
  meta: TokenMetaFlags,
  menuDepth: number,
): { isInOption: boolean; source: string | null; optionText: string | null; condition?: ConditionMetadata } {
  const isInOption = meta.hasMenuOptionBlock;
  const menu = menuAtDepth(scanState.menuStack, menuDepth);
  const decisionContext = scanState.conditionalDecisionStack[scanState.conditionalDecisionStack.length - 1];
  const source = isInOption && menu ? menu.id : (decisionContext?.decisionNodeId ?? scanState.currentLabelId);
  const condition: ConditionMetadata | undefined = decisionContext
    ? {
      branchKind: decisionContext.branchKind,
      expression: decisionContext.expression ?? undefined,
      references: decisionContext.references,
      decisionNodeId: decisionContext.decisionNodeId,
    }
    : undefined;
  return { isInOption, source, optionText: menu?.optionText ?? null, condition };
}

function resolveTargetLabelId(
  state: ParseGraphState,
  targetExpression: string,
): { resolvedTargetId: string } {
  const targetName = targetExpression.trim();
  const resolvedTargetId = state.canonicalLabelIdByName.get(targetName) ?? targetName;
  return { resolvedTargetId };
}

function emitJumpEdge(
  state: ParseGraphState,
  scanState: ParseScanState,
  target: string,
  context: { isInOption: boolean; source: string | null; optionText: string | null; condition?: ConditionMetadata },
  suppressFallthrough: boolean,
) {
  const { isInOption, source, optionText } = context;
  if (source) {
    const { resolvedTargetId } = resolveTargetLabelId(state, target);
    const edgeId = `jump_${source}__${resolvedTargetId}_${optionText ?? ''}`;
    addEdge(state, {
      id: edgeId,
      source,
      target: resolvedTargetId,
      kind: 'jump',
      label: isInOption ? (optionText ?? undefined) : undefined,
      condition: context.condition,
    });
    if (!isInOption && scanState.currentLabelId) {
      addOutgoing(state, scanState.currentLabelId, 'jump');
      addIncoming(state, resolvedTargetId, 'jump');
    } else if (isInOption) {
      // Register the menu node's outgoing jump traffic so that fallthrough
      // detection (hasOutgoingEdge) correctly skips menus whose options all
      // explicitly jump to another label.
      addOutgoing(state, source, 'jump');
      addIncoming(state, resolvedTargetId, 'jump');
    }
  }
  if (suppressFallthrough && !isInOption && scanState.conditionalIndentStack.length === 0) {
    scanState.labelHasExplicitExit = true;
  }
}

function emitCallEdge(
  state: ParseGraphState,
  scanState: ParseScanState,
  target: string,
  context: { isInOption: boolean; source: string | null; optionText: string | null; condition?: ConditionMetadata },
) {
  const { isInOption, source, optionText } = context;
  if (!source) return;
  const { resolvedTargetId } = resolveTargetLabelId(state, target);
  const edgeId = `call_${source}__${resolvedTargetId}_${optionText ?? ''}`;
  addEdge(state, {
    id: edgeId,
    source,
    target: resolvedTargetId,
    kind: 'call',
    label: isInOption ? (optionText ? `call: ${optionText}` : 'call') : 'call',
    condition: context.condition,
  });
  state.calledLabels.add(resolvedTargetId);
  if (!isInOption && scanState.currentLabelId) {
    addOutgoing(state, scanState.currentLabelId, 'call');
    addIncoming(state, resolvedTargetId, 'call');
  }
  state.pendingCallReturns.push({
    returnTargetId: source,
    callTargetId: resolvedTargetId,
  });
  if (isInOption) state.calledFromMenuOptionTargets.add(resolvedTargetId);
}

function extractLiteralTarget(expression: string): string | null {
  const trimmed = expression.trim();
  const match = QUOTED_LITERAL_PATTERN.exec(trimmed);
  if (!match) return null;
  const value = match[2] ?? null;
  if (value !== null && value.trim().length === 0) return null;
  return value;
}

function extractIdentifierTarget(expression: string): string | null {
  const trimmed = expression.trim();
  return IDENTIFIER_PATTERN.test(trimmed) ? trimmed : null;
}

function resolveStaticTargetExpression(
  expression: string,
  scanState: ParseScanState,
): string | null {
  const literal = extractLiteralTarget(expression);
  if (literal) return literal;
  const identifier = extractIdentifierTarget(expression);
  if (!identifier) return null;
  return scanState.labelVariableLiteralTargets.get(identifier) ?? null;
}

function resolveJumpStatementTarget(
  scanState: ParseScanState,
  targetExpression: string,
): string | null {
  if (!scanState.waitForJumpExpressionTarget) return targetExpression;
  const targetIdentifier = extractIdentifierTarget(targetExpression);
  if (!targetIdentifier) return null;
  return scanState.labelVariableLiteralTargets.get(targetIdentifier) ?? null;
}

function splitTopLevelArguments(argumentList: string): string[] {
  const args: string[] = [];
  let depth = 0;
  let activeQuote: '"' | '\'' | null = null;
  let tripleQuoted = false;
  let start = 0;

  for (let i = 0; i < argumentList.length; i += 1) {
    const char = argumentList[i];
    if (activeQuote) {
      if (tripleQuoted) {
        if (char === activeQuote && argumentList[i + 1] === activeQuote && argumentList[i + 2] === activeQuote) {
          i += 2;
          activeQuote = null;
          tripleQuoted = false;
        }
        continue;
      }
      if (char === '\\') {
        i += 1;
        continue;
      }
      if (char === activeQuote) activeQuote = null;
      continue;
    }
    if ((char === '"' || char === '\'') && argumentList[i + 1] === char && argumentList[i + 2] === char) {
      activeQuote = char;
      tripleQuoted = true;
      i += 2;
      continue;
    }
    if (char === '"' || char === '\'') {
      activeQuote = char;
      continue;
    }
    if (char === '(' || char === '[' || char === '{') {
      depth += 1;
      continue;
    }
    if (char === ')' || char === ']' || char === '}') {
      if (depth > 0) depth -= 1;
      continue;
    }
    if (depth === 0 && char === ',') {
      const segment = argumentList.slice(start, i).trim();
      if (segment) args.push(segment);
      start = i + 1;
    }
  }

  const last = argumentList.slice(start).trim();
  if (last) args.push(last);
  return args;
}

// Finds the first delimiter at the current expression depth. This is used for
// top-level argument splitting/keyword parsing (`=`), dictionary payloads (`:`),
// and comma-separated argument handling.
function findTopLevelDelimiterIndex(text: string, delimiter: ',' | '=' | ':'): number {
  let depth = 0;
  let activeQuote: '"' | '\'' | null = null;
  let tripleQuoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (activeQuote) {
      if (tripleQuoted) {
        if (char === activeQuote && text[i + 1] === activeQuote && text[i + 2] === activeQuote) {
          i += 2;
          activeQuote = null;
          tripleQuoted = false;
        }
        continue;
      }
      if (char === '\\') {
        i += 1;
        continue;
      }
      if (char === activeQuote) activeQuote = null;
      continue;
    }
    if ((char === '"' || char === '\'') && text[i + 1] === char && text[i + 2] === char) {
      activeQuote = char;
      tripleQuoted = true;
      i += 2;
      continue;
    }
    if (char === '"' || char === '\'') {
      activeQuote = char;
      continue;
    }
    if (char === '(' || char === '[' || char === '{') {
      depth += 1;
      continue;
    }
    if (char === ')' || char === ']' || char === '}') {
      if (depth > 0) depth -= 1;
      continue;
    }
    if (depth === 0 && char === delimiter) return i;
  }
  return -1;
}

function extractStaticTargetFromArgumentList(argumentList: string, scanState: ParseScanState): string | null {
  const args = splitTopLevelArguments(argumentList);
  if (args.length === 0) return null;

  const firstArgument = args[0];
  const directTarget = resolveStaticTargetExpression(firstArgument, scanState);
  if (directTarget) return directTarget;

  const preferredKeywordNames = new Set(['label', 'target']);
  for (const arg of args) {
    const equalsIndex = findTopLevelDelimiterIndex(arg, '=');
    if (equalsIndex <= 0) continue;
    const keyword = arg.slice(0, equalsIndex).trim().toLowerCase();
    if (!preferredKeywordNames.has(keyword)) continue;
    const target = resolveStaticTargetExpression(arg.slice(equalsIndex + 1), scanState);
    if (target) return target;
  }

  const equalsIndex = findTopLevelDelimiterIndex(firstArgument, '=');
  if (equalsIndex <= 0) return null;
  return resolveStaticTargetExpression(firstArgument.slice(equalsIndex + 1), scanState);
}

function extractNestedExpressionValue(expression: string): string {
  const equalsIndex = findTopLevelDelimiterIndex(expression, '=');
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
  if (opener === '[' || opener === '(' || opener === '{') {
    const inner = trimmed.slice(1, -1);
    for (const item of splitTopLevelArguments(inner)) {
      if (opener === '{') {
        const colonIndex = findTopLevelDelimiterIndex(item, ':');
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
  while (identifierEnd < trimmed.length && IDENTIFIER_PART_PATTERN.test(trimmed[identifierEnd] ?? '')) {
    identifierEnd += 1;
  }
  const construct = trimmed.slice(0, identifierEnd);
  const afterIdentifier = skipWhitespace(trimmed, identifierEnd);
  if (trimmed[afterIdentifier] !== '(') return;

  const parsedArguments = readParenthesizedArgument(trimmed, afterIdentifier + 1);
  if (!parsedArguments || parsedArguments.endIndex !== trimmed.length) return;

  visitCall(construct, parsedArguments.argument);
  if (!isRecursiveScreenActionWrapper(construct)) {
    return;
  }
  for (const argument of splitTopLevelArguments(parsedArguments.argument)) {
    walkScreenActionExpression(extractNestedExpressionValue(argument), visitCall);
  }
}

function buildIgnoredPositionMask(text: string): boolean[] {
  const ignored = new Array<boolean>(text.length).fill(false);
  let activeQuote: '"' | '\'' | null = null;
  let tripleQuoted = false;
  let inComment = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (inComment) {
      ignored[i] = true;
      if (char === '\n') inComment = false;
      continue;
    }

    if (activeQuote) {
      ignored[i] = true;
      if (!tripleQuoted && char === '\\') {
        if (i + 1 < text.length) {
          ignored[i + 1] = true;
          i += 1;
        }
        continue;
      }
      if (tripleQuoted) {
        if (char === activeQuote && text[i + 1] === activeQuote && text[i + 2] === activeQuote) {
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

    if (char === '#') {
      ignored[i] = true;
      inComment = true;
      continue;
    }

    if ((char === '"' || char === '\'') && text[i + 1] === char && text[i + 2] === char) {
      ignored[i] = true;
      if (i + 1 < text.length) ignored[i + 1] = true;
      if (i + 2 < text.length) ignored[i + 2] = true;
      i += 2;
      activeQuote = char;
      tripleQuoted = true;
      continue;
    }

    if (char === '"' || char === '\'') {
      ignored[i] = true;
      activeQuote = char;
      tripleQuoted = false;
    }
  }

  return ignored;
}

function stripInlineComment(value: string): string {
  let activeQuote: '"' | '\'' | null = null;
  let tripleQuoted = false;
  for (let i = 0; i < value.length; i += 1) {
    const char = value[i];
    if (activeQuote) {
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
      if (char === '\\') {
        i += 1;
        continue;
      }
      if (char === activeQuote) activeQuote = null;
      continue;
    }
    if (
      i + 2 < value.length &&
      (char === '"' || char === '\'') &&
      value[i + 1] === char &&
      value[i + 2] === char
    ) {
      activeQuote = char;
      tripleQuoted = true;
      i += 2;
      continue;
    }
    if (char === '"' || char === '\'') {
      activeQuote = char;
      continue;
    }
    if (char === '#') {
      return value.slice(0, i).trim();
    }
  }
  return value.trim();
}

interface PythonAssignmentEvent {
  kind: 'assignment';
  index: number;
  variableName: string;
  assignedTarget: string | null;
}

interface PythonRenpyCallEvent {
  kind: 'call';
  index: number;
  callType: 'jump' | 'call';
  construct: 'renpy.jump' | 'renpy.call';
  targetExpression: string;
}

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
    const callType = match[1] === 'jump' ? 'jump' : 'call';
    const construct = callType === 'jump' ? 'renpy.jump' : 'renpy.call';
    const parsed = readParenthesizedArgument(blockText, PYTHON_RENPY_CALL_START_PATTERN.lastIndex);
    if (!parsed) continue;
    PYTHON_RENPY_CALL_START_PATTERN.lastIndex = parsed.endIndex;
    events.push({
      kind: 'call',
      index: match.index,
      callType,
      construct,
      targetExpression: parsed.argument,
    });
  }

  PYTHON_ASSIGNMENT_PATTERN.lastIndex = 0;
  while ((match = PYTHON_ASSIGNMENT_PATTERN.exec(blockText)) !== null) {
    if (ignoredMask[match.index]) continue;
    const variableName = (match[1] ?? '').trim();
    if (!variableName) continue;
    const assignedExpression = stripInlineComment(match[2] ?? '');
    const assignedTarget = resolveStaticTargetExpression(assignedExpression, scanState);
    events.push({
      kind: 'assignment',
      index: match.index,
      variableName,
      assignedTarget,
    });
  }

  events.sort((a, b) => a.index - b.index);

  for (const event of events) {
    if (event.kind === 'assignment') {
      if (event.assignedTarget) {
        scanState.labelVariableLiteralTargets.set(event.variableName, event.assignedTarget);
      } else {
        scanState.labelVariableLiteralTargets.delete(event.variableName);
      }
      continue;
    }

    const context = resolveCallContext(scanState, meta, menuDepth);
    const target = extractStaticTargetFromArgumentList(event.targetExpression, scanState);
    if (!target) {
      addDynamicTargetDiagnostic(state, chapter, event.construct, event.targetExpression, context.source ?? undefined);
      continue;
    }

    if (event.callType === 'jump') {
      emitJumpEdge(state, scanState, target, context, false);
    } else {
      emitCallEdge(state, scanState, target, context);
    }
  }
}

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
  const emitActionCall = (construct: string, targetExpression: string) => {
    const callType = screenActionRuleMap.get(construct.toLowerCase());
    if (!callType) return;
    const context = resolveCallContext(scanState, meta, menuDepth);
    const target = extractStaticTargetFromArgumentList(targetExpression, scanState);
    if (!target) {
      addDynamicTargetDiagnostic(state, chapter, construct, targetExpression, context.source ?? undefined);
      return;
    }
    const dedupeKey = `${construct.toLowerCase()}|${target}|${context.source ?? ''}`;
    if (seenCalls.has(dedupeKey)) return;
    seenCalls.add(dedupeKey);
    if (callType === 'jump') {
      emitJumpEdge(state, scanState, target, context, false);
    } else {
      emitCallEdge(state, scanState, target, context);
    }
  };

  for (const expression of extractScreenActionExpressions(blockText)) {
    walkScreenActionExpression(expression, emitActionCall);
  }
}

function resetStaleWaitFlags(scanState: ParseScanState, type: number): void {
  // Wait flags are transient parser intents (e.g. "next function-name is a jump target").
  // On malformed or mixed token streams, these intents can leak into later tokens and create
  // false edges; this guard clears stale waits when token context no longer matches.
  if (type === PARSER_TOKENS.charWhitespace || type === PARSER_TOKENS.charNewline) return;
  if (type === PARSER_TOKENS.kwLabel || isMenuKeywordTokenType(type)) {
    scanState.waitForJumpTarget = false;
    scanState.waitForJumpExpressionTarget = false;
    scanState.waitForCallTarget = false;
    scanState.waitForMenuNameForId = null;
    return;
  }
  if (scanState.waitForJumpTarget && type !== PARSER_TOKENS.entityFunctionName) {
    if (PARSER_TOKENS.kwExpression !== undefined && type === PARSER_TOKENS.kwExpression) {
      scanState.waitForJumpExpressionTarget = true;
    } else {
      scanState.waitForJumpTarget = false;
      scanState.waitForJumpExpressionTarget = false;
    }
  }
  if (scanState.waitForCallTarget && type !== PARSER_TOKENS.entityFunctionName) {
    scanState.waitForCallTarget = false;
  }
  if (scanState.waitForMenuNameForId && type !== PARSER_TOKENS.entityFunctionName) {
    scanState.waitForMenuNameForId = null;
  }
}

function resolveConditionalSource(scanState: ParseScanState, meta: TokenMetaFlags, menuDepth: number): string | null {
  if (meta.hasMenuOptionBlock) {
    const menu = menuAtDepth(scanState.menuStack, menuDepth);
    return menu?.id ?? scanState.currentLabelId;
  }
  return scanState.currentLabelId;
}

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
  if (pending.kind === 'if') {
    state.decisionCounter += 1;
    const decisionNodeId = `decision_${state.decisionCounter}`;
    const references = extractConditionFlagRefs(pending.expression ?? undefined);
    addNode(state, {
      id: decisionNodeId,
      type: 'DECISION',
      label: pending.expression ? `if ${pending.expression}` : 'if',
      dialogueCount: 0,
      chapter,
      parentLabelId: scanState.currentLabelId ?? undefined,
      condition: {
        branchKind: 'if',
        expression: pending.expression ?? undefined,
        references,
        decisionNodeId,
      },
    });
    addEdge(state, {
      id: `seq_${source}__${decisionNodeId}`,
      source,
      target: decisionNodeId,
      kind: 'sequence',
      label: 'if',
    });
    addOutgoing(state, source, 'sequence');
    addIncoming(state, decisionNodeId, 'sequence');
    scanState.conditionalDecisionStack.push({
      indent: pending.indent,
      decisionNodeId,
      sourceId: source,
      branchKind: 'if',
      expression: pending.expression,
      references,
    });
    scanState.pendingConditionalHeader = null;
    return true;
  }
  const existing = scanState.conditionalDecisionStack[scanState.conditionalDecisionStack.length - 1];
  if (!existing || existing.indent !== pending.indent) {
    scanState.pendingConditionalHeader = null;
    return false;
  }
  existing.branchKind = pending.kind;
  existing.expression = pending.expression;
  existing.references = extractConditionFlagRefs(pending.expression ?? undefined);
  scanState.pendingConditionalHeader = null;
  return true;
}

export function handleToken(
  state: ParseGraphState,
  scanState: ParseScanState,
  input: HandleTokenInput,
): void {
  if (!scanState.conditionalDecisionStack) {
    scanState.conditionalDecisionStack = [];
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
  const { type, meta, val, chapter, menuDepth, lineIndent, captureDialogueLines, screenActionRuleMap } = input;
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
    const definitionCount = (state.labelDefinitionCountByName.get(declaredLabelName) ?? 0) + 1;
    state.labelDefinitionCountByName.set(declaredLabelName, definitionCount);
    const canonicalLabelId = state.canonicalLabelIdByName.get(declaredLabelName) ?? declaredLabelName;
    state.canonicalLabelIdByName.set(declaredLabelName, canonicalLabelId);
    const newLabelId =
      definitionCount === 1
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
        kind: 'sequence',
        label: 'next',
      });
      addOutgoing(state, scanState.currentLabelId, 'sequence');
      addIncoming(state, newLabelId, 'sequence');
    }

    scanState.currentLabelId = newLabelId;
    scanState.currentLabelBaseId = newLabelId;
    scanState.currentLabelDeclaredName = declaredLabelName;
    scanState.currentLabelSceneIndex = 1;
    scanState.currentLabelHasSplit = false;
    scanState.currentLabelHasContentSinceSceneBoundary = false;
    scanState.currentLabelIndent = lineIndent;
    scanState.labelVariableLiteralTargets.clear();
    for (const menuId of scanState.pendingMenuFallthroughIds) {
      addEdge(state, {
        id: `seq_${menuId}__${newLabelId}`,
        source: menuId,
        target: newLabelId,
        kind: 'sequence',
        label: 'next',
      });
      addOutgoing(state, menuId, 'sequence');
      addIncoming(state, newLabelId, 'sequence');
    }
    scanState.pendingMenuFallthroughIds = [];
    state.allLabelIds.add(newLabelId);
    scanState.labelHasExplicitExit = false;
    scanState.waitForLabelName = false;

    addNode(state, {
      id: newLabelId,
      type: 'LABEL',
      label: declaredLabelName,
      dialogueCount: 0,
      chapter,
      isShadowed: definitionCount > 1,
      shadowOfId: definitionCount > 1 ? canonicalLabelId : undefined,
    });
    if (definitionCount > 1) {
      const diagnosticId = `shadowed_label|${chapter}|${declaredLabelName}|${newLabelId}|${canonicalLabelId}`;
      addParseDiagnostic(
        state,
        {
          code: 'shadowed_label',
          severity: 'warning',
          location: {
            chapter,
            construct: 'label',
            sourceId: newLabelId,
            targetId: canonicalLabelId,
          },
          context: {
            category: 'shadowed_label',
            detail: declaredLabelName,
          },
          message: `Label "${declaredLabelName}" is a duplicate definition and is shadowed by canonical label "${canonicalLabelId}".`,
          recoveryAction: 'Rename duplicate labels or keep one canonical definition.',
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
    splitCurrentLabelOnSceneBoundary(state, scanState, chapter);
    return;
  }

  if (type === PARSER_TOKENS.kwConditional) {
    handleConditionalHeader(state, scanState, meta, menuDepth, chapter);
  }

  if (type === PARSER_TOKENS.metaPythonBlock) {
    scanState.currentLabelHasContentSinceSceneBoundary = true;
    processDirectRenpyBlockCalls(state, scanState, meta, chapter, menuDepth, val());
    return;
  }

  if (type === PARSER_TOKENS.metaScreenBlock) {
    scanState.currentLabelHasContentSinceSceneBoundary = true;
    processDirectScreenActionCalls(state, scanState, meta, chapter, menuDepth, val(), screenActionRuleMap);
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
      type: 'MENU',
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
        kind: 'sequence',
        label: 'next',
      });
      addOutgoing(state, closedMenu.id, 'sequence');
      addIncoming(state, newMenuId, 'sequence');
    }

    const parentMenu = scanState.menuStack[scanState.menuStack.length - 1];
    const decisionContext = scanState.conditionalDecisionStack[scanState.conditionalDecisionStack.length - 1];
    const source = parentMenu ? parentMenu.id : (decisionContext?.decisionNodeId ?? scanState.currentLabelId);
    if (source) {
      addEdge(state, {
        id: edgeIdWithOption(`seq_${source}__${newMenuId}`, parentMenu?.optionText),
        source,
        target: newMenuId,
        kind: 'sequence',
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
      addOutgoing(state, source, 'sequence');
      addIncoming(state, newMenuId, 'sequence');
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

  if (type === PARSER_TOKENS.kwJump && meta.hasJumpStatement) {
    scanState.currentLabelHasContentSinceSceneBoundary = true;
    scanState.waitForJumpTarget = true;
    scanState.waitForJumpExpressionTarget = false;
    return;
  }

  if (
    type === PARSER_TOKENS.entityFunctionName &&
    scanState.waitForJumpTarget &&
    meta.hasJumpStatement
  ) {
    const targetExpression = val();
    const target = resolveJumpStatementTarget(scanState, targetExpression);
    const context = resolveCallContext(scanState, meta, menuDepth);
    if (!target) {
      addDynamicTargetDiagnostic(state, chapter, 'jump expression', targetExpression, context.source ?? undefined);
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
    emitJumpEdge(state, scanState, target, context, true);
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
    if (isReliableReturn) {
      scanState.labelHasExplicitExit = true;
      state.hasReliableReturnInLabel.add(scanState.currentLabelId);
    }
    state.hasReturnInLabel.add(scanState.currentLabelId);
    return;
  }

  if (type === PARSER_TOKENS.literalString) {
    const isSay =
      meta.hasSayNarrator ||
      meta.hasSayCharacter ||
      meta.hasSayStatement;
    const isMenuOption = meta.hasMenuOption;

    if (isSay && !isMenuOption) {
      scanState.currentLabelHasContentSinceSceneBoundary = true;
      const menu = menuAtDepth(scanState.menuStack, menuDepth);
      const ownerId =
        meta.hasMenuOptionBlock && menu
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
