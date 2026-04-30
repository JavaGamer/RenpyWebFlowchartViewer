import { PARSER_TOKENS } from '../parserTokens';
import type { ParseGraphState, ParseScanState, TokenMetaFlags } from './pipelineTypes';
import { menuAtDepth, parentMenuStackLength, edgeIdWithOption } from './scanTransitions';
import { addNode, addEdge, addIncoming, addOutgoing } from './graphMutations';
import { assertInvariant } from './pipelineInvariants';
import type { ScreenActionKind } from '../config/parserRules';
import { addParseWarning } from './warnings';

interface HandleTokenInput {
  type: number;
  meta: TokenMetaFlags;
  val: () => string;
  chapter: string;
  menuDepth: number;
  captureDialogueLines: boolean;
  screenActionRuleMap: Map<string, ScreenActionKind>;
}

function hasOutgoingEdge(state: ParseGraphState, sourceId: string): boolean {
  return state.outgoingByLabel.has(sourceId);
}

const QUOTED_LITERAL_PATTERN = /^(?:[rR]|[uU]|[bB]|[rR][bB]|[bB][rR])?(?:("""|'''|"|')([\s\S]*?)\1)$/;
const PYTHON_RENPY_CALL_START_PATTERN = /\brenpy\.(jump|call)\s*\(/g;
const SCREEN_ACTION_CALL_START_PATTERN = /\baction(?:\s+|\s*=\s*)([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;

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

function addDynamicTargetWarning(
  state: ParseGraphState,
  chapter: string,
  construct: string,
  targetExpression: string,
  sourceId?: string,
) {
  const warningId = [
    'dynamic_target',
    chapter,
    construct,
    targetExpression.trim(),
    sourceId ?? '',
  ].join('|');
  addParseWarning(
    state,
    {
      code: 'dynamic_target',
      chapter,
      construct,
      targetExpression: targetExpression.trim(),
      sourceId,
      message: `Dynamic ${construct} target cannot be resolved statically: ${targetExpression.trim()}`,
    },
    warningId,
  );
}

function resolveCallContext(
  scanState: ParseScanState,
  meta: TokenMetaFlags,
  menuDepth: number,
): { isInOption: boolean; source: string | null; optionText: string | null } {
  const isInOption = meta.hasMenuOptionBlock;
  const menu = menuAtDepth(scanState.menuStack, menuDepth);
  const source = isInOption && menu ? menu.id : scanState.currentLabelId;
  return { isInOption, source, optionText: menu?.optionText ?? null };
}

function emitJumpEdge(
  state: ParseGraphState,
  scanState: ParseScanState,
  target: string,
  context: { isInOption: boolean; source: string | null; optionText: string | null },
  suppressFallthrough: boolean,
) {
  const { isInOption, source, optionText } = context;
  if (source) {
    addEdge(state, {
      id: `jump_${source}__${target}_${optionText ?? ''}`,
      source,
      target,
      kind: 'jump',
      label: isInOption ? (optionText ?? undefined) : undefined,
    });
  }
  if (!isInOption && scanState.currentLabelId) {
    addOutgoing(state, scanState.currentLabelId, 'jump');
    addIncoming(state, target, 'jump');
  }
  if (suppressFallthrough && !isInOption && scanState.conditionalIndentStack.length === 0) {
    scanState.labelHasExplicitExit = true;
  }
}

function emitCallEdge(
  state: ParseGraphState,
  scanState: ParseScanState,
  target: string,
  context: { isInOption: boolean; source: string | null; optionText: string | null },
) {
  const { isInOption, source, optionText } = context;
  if (!source) return;
  addEdge(state, {
    id: `call_${source}__${target}_${optionText ?? ''}`,
    source,
    target,
    kind: 'call',
    label: isInOption ? (optionText ? `call: ${optionText}` : 'call') : 'call',
  });

  state.calledLabels.add(target);
  if (!isInOption && scanState.currentLabelId) {
    addOutgoing(state, scanState.currentLabelId, 'call');
    addIncoming(state, target, 'call');
    state.pendingCallReturns.push({
      callerLabelId: scanState.currentLabelId,
      callTargetId: target,
    });
  }
  if (isInOption) state.calledFromMenuOptionTargets.add(target);
}

function extractLiteralTarget(expression: string): string | null {
  const trimmed = expression.trim();
  const match = QUOTED_LITERAL_PATTERN.exec(trimmed);
  if (!match) return null;
  const value = match[2] ?? null;
  if (value !== null && value.trim().length === 0) return null;
  return value;
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

function findTopLevelDelimiterIndex(text: string, delimiter: ',' | '='): number {
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

function extractStaticTargetFromArgumentList(argumentList: string): string | null {
  const args = splitTopLevelArguments(argumentList);
  if (args.length === 0) return null;

  const firstArgument = args[0];
  const directLiteral = extractLiteralTarget(firstArgument);
  if (directLiteral) return directLiteral;

  const preferredKeywordNames = new Set(['label', 'target']);
  for (const arg of args) {
    const equalsIndex = findTopLevelDelimiterIndex(arg, '=');
    if (equalsIndex <= 0) continue;
    const keyword = arg.slice(0, equalsIndex).trim().toLowerCase();
    if (!preferredKeywordNames.has(keyword)) continue;
    const literal = extractLiteralTarget(arg.slice(equalsIndex + 1));
    if (literal) return literal;
  }

  const equalsIndex = findTopLevelDelimiterIndex(firstArgument, '=');
  if (equalsIndex <= 0) return null;
  return extractLiteralTarget(firstArgument.slice(equalsIndex + 1));
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

function processDirectRenpyBlockCalls(
  state: ParseGraphState,
  scanState: ParseScanState,
  meta: TokenMetaFlags,
  chapter: string,
  menuDepth: number,
  blockText: string,
) {
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
    const targetExpression = parsed.argument;
    const target = extractStaticTargetFromArgumentList(targetExpression);
    const context = resolveCallContext(scanState, meta, menuDepth);

    if (!target) {
      addDynamicTargetWarning(state, chapter, construct, targetExpression, context.source ?? undefined);
      continue;
    }

    if (callType === 'jump') {
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
  const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const seenCalls = new Set<string>();
  const ignoredMask = buildIgnoredPositionMask(blockText);
  const emitActionCall = (construct: string, targetExpression: string) => {
    const callType = screenActionRuleMap.get(construct.toLowerCase());
    if (!callType) return;
    const context = resolveCallContext(scanState, meta, menuDepth);
    const target = extractStaticTargetFromArgumentList(targetExpression);
    if (!target) {
      addDynamicTargetWarning(state, chapter, construct, targetExpression, context.source ?? undefined);
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

  SCREEN_ACTION_CALL_START_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = SCREEN_ACTION_CALL_START_PATTERN.exec(blockText)) !== null) {
    if (ignoredMask[match.index]) {
      continue;
    }
    const construct = match[1];
    if (!screenActionRuleMap.has(construct.toLowerCase())) continue;
    const parsed = readParenthesizedArgument(blockText, SCREEN_ACTION_CALL_START_PATTERN.lastIndex);
    if (!parsed) continue;
    SCREEN_ACTION_CALL_START_PATTERN.lastIndex = parsed.endIndex;
    emitActionCall(construct, parsed.argument);
  }

  for (const [ruleName] of screenActionRuleMap.entries()) {
    const callPattern = new RegExp(`\\b(${escapeRegex(ruleName)})\\s*\\(`, 'gi');
    let callMatch: RegExpExecArray | null;
    while ((callMatch = callPattern.exec(blockText)) !== null) {
      const callIndex = callMatch.index;
      if (ignoredMask[callIndex]) continue;
      const parsed = readParenthesizedArgument(blockText, callPattern.lastIndex);
      if (!parsed) continue;
      callPattern.lastIndex = parsed.endIndex;
      emitActionCall(callMatch[1] ?? ruleName, parsed.argument);
    }
  }
}

function resetStaleWaitFlags(scanState: ParseScanState, type: number): void {
  // Wait flags are transient parser intents (e.g. "next function-name is a jump target").
  // On malformed or mixed token streams, these intents can leak into later tokens and create
  // false edges; this guard clears stale waits when token context no longer matches.
  if (type === PARSER_TOKENS.charWhitespace || type === PARSER_TOKENS.charNewline) return;
  if (type === PARSER_TOKENS.kwLabel || type === PARSER_TOKENS.kwMenuObserved) {
    scanState.waitForJumpTarget = false;
    scanState.waitForCallTarget = false;
    scanState.waitForMenuNameForId = null;
    return;
  }
  if (scanState.waitForJumpTarget && type !== PARSER_TOKENS.entityFunctionName) {
    scanState.waitForJumpTarget = false;
  }
  if (scanState.waitForCallTarget && type !== PARSER_TOKENS.entityFunctionName) {
    scanState.waitForCallTarget = false;
  }
  if (scanState.waitForMenuNameForId && type !== PARSER_TOKENS.entityFunctionName) {
    scanState.waitForMenuNameForId = null;
  }
}

export function handleToken(
  state: ParseGraphState,
  scanState: ParseScanState,
  input: HandleTokenInput,
): void {
  const { type, meta, val, chapter, menuDepth, captureDialogueLines, screenActionRuleMap } = input;
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
    scanState.waitForJumpTarget = false;
    scanState.waitForCallTarget = false;
    scanState.waitForMenuNameForId = null;
    return;
  }

  if (
    type === PARSER_TOKENS.entityFunctionName &&
    scanState.waitForLabelName &&
    meta.hasLabelStatement
  ) {
    const newLabelId = val();
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
      label: newLabelId,
      dialogueCount: 0,
      chapter,
    });
    return;
  }

  if (type === PARSER_TOKENS.metaPythonBlock) {
    processDirectRenpyBlockCalls(state, scanState, meta, chapter, menuDepth, val());
    return;
  }

  if (type === PARSER_TOKENS.metaScreenBlock) {
    processDirectScreenActionCalls(state, scanState, meta, chapter, menuDepth, val(), screenActionRuleMap);
    return;
  }

  if (scanState.currentLabelId === null) return;

  if (type === PARSER_TOKENS.kwMenuObserved && meta.hasMenuStatement) {
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
    const source = parentMenu ? parentMenu.id : scanState.currentLabelId;
    if (source) {
      addEdge(state, {
        id: edgeIdWithOption(`seq_${source}__${newMenuId}`, parentMenu?.optionText),
        source,
        target: newMenuId,
        kind: 'sequence',
        label: parentMenu?.optionText ?? undefined,
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
    scanState.waitForJumpTarget = true;
    return;
  }

  if (
    type === PARSER_TOKENS.entityFunctionName &&
    scanState.waitForJumpTarget &&
    meta.hasJumpStatement
  ) {
    const target = val();
    const context = resolveCallContext(scanState, meta, menuDepth);
    emitJumpEdge(state, scanState, target, context, true);
    scanState.waitForJumpTarget = false;
    return;
  }

  if (type === PARSER_TOKENS.kwCall && meta.hasCallStatement) {
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
    if (scanState.conditionalIndentStack.length === 0) {
      scanState.labelHasExplicitExit = true;
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
