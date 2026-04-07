import { PARSER_TOKENS } from '../parserTokens';
import type { ParseGraphState, ParseScanState, TokenMetaFlags } from './pipelineTypes';
import { menuAtDepth, parentMenuStackLength, edgeIdWithOption } from './scanTransitions';
import { addNode, addEdge, addIncoming, addOutgoing } from './graphMutations';
import { assertInvariant } from './pipelineInvariants';

interface HandleTokenInput {
  type: number;
  meta: TokenMetaFlags;
  val: () => string;
  chapter: string;
  menuDepth: number;
  captureDialogueLines: boolean;
}

type DirectConstruct = 'renpy.jump' | 'renpy.call' | 'Jump' | 'Call';

const QUOTED_LITERAL_PATTERN = /^(["'])([\s\S]*)\1$/;
const PYTHON_RENPY_CALL_START_PATTERN = /renpy\.(jump|call)\s*\(/g;
const SCREEN_ACTION_CALL_START_PATTERN = /\baction\s+(Jump|Call)\s*\(/g;

function readParenthesizedArgument(
  text: string,
  argumentStartIndex: number,
): { argument: string; endIndex: number } | null {
  let depth = 1;
  let index = argumentStartIndex;
  let activeQuote: '"' | '\'' | null = null;

  while (index < text.length) {
    const char = text[index];
    if (activeQuote) {
      if (char === '\\') {
        index += 2;
        continue;
      }
      if (char === activeQuote) {
        activeQuote = null;
      }
      index += 1;
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
  construct: DirectConstruct,
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
  if (state.warningIds.has(warningId)) return;
  state.warningIds.add(warningId);
  state.warnings.push({
    code: 'dynamic_target',
    chapter,
    construct,
    targetExpression: targetExpression.trim(),
    sourceId,
    message: `Dynamic ${construct} target cannot be resolved statically: ${targetExpression.trim()}`,
  });
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
  return match[2] ?? null;
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
  let match: RegExpExecArray | null;
  while ((match = PYTHON_RENPY_CALL_START_PATTERN.exec(blockText)) !== null) {
    const callType = match[1] === 'jump' ? 'jump' : 'call';
    const construct: DirectConstruct = callType === 'jump' ? 'renpy.jump' : 'renpy.call';
    const parsed = readParenthesizedArgument(blockText, PYTHON_RENPY_CALL_START_PATTERN.lastIndex);
    if (!parsed) break;
    PYTHON_RENPY_CALL_START_PATTERN.lastIndex = parsed.endIndex;
    const targetExpression = parsed.argument;
    const target = extractLiteralTarget(targetExpression);
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
) {
  SCREEN_ACTION_CALL_START_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = SCREEN_ACTION_CALL_START_PATTERN.exec(blockText)) !== null) {
    const callType = match[1] === 'Jump' ? 'jump' : 'call';
    const construct: DirectConstruct = callType === 'jump' ? 'Jump' : 'Call';
    const parsed = readParenthesizedArgument(blockText, SCREEN_ACTION_CALL_START_PATTERN.lastIndex);
    if (!parsed) break;
    SCREEN_ACTION_CALL_START_PATTERN.lastIndex = parsed.endIndex;
    const targetExpression = parsed.argument;
    const target = extractLiteralTarget(targetExpression);
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

export function handleToken(
  state: ParseGraphState,
  scanState: ParseScanState,
  input: HandleTokenInput,
): void {
  const { type, meta, val, chapter, menuDepth, captureDialogueLines } = input;

  if (type === PARSER_TOKENS.kwLabel && meta.hasLabelStatement) {
    scanState.waitForLabelName = true;
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
    processDirectScreenActionCalls(state, scanState, meta, chapter, menuDepth, val());
    return;
  }

  if (scanState.currentLabelId === null) return;

  if (type === PARSER_TOKENS.kwMenuObserved && meta.hasMenuStatement) {
    while (scanState.menuStack.length > parentMenuStackLength(menuDepth)) {
      scanState.menuStack.pop();
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
    scanState.labelHasExplicitExit = true;
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
