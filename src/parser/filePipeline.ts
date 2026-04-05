import { Tokenizer } from '@renpy/ast/out/tokenizer/tokenizer';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { PARSER_TOKENS } from '../parserTokens';
import type { ParseGraphState } from './pipelineTypes';
import { analyzeTokenMeta } from './tokenMeta';
import { createScanState } from './pipelineState';
import {
  maybeUpdateConditionalState,
  parentMenuStackLength,
  menuAtDepth,
  edgeIdWithOption,
} from './scanTransitions';
import { addNode, addEdge, addIncoming, addOutgoing } from './graphMutations';
import { assertInvariant } from './pipelineInvariants';

let _docVersion = 0;

async function renpyParse(content: string) {
  const document = TextDocument.create('file://my.rpy', 'rpy', ++_docVersion, content);
  return { document, nodes: await Tokenizer.tokenizeDocument(document) };
}

export async function parseOneFile(
  state: ParseGraphState,
  file: { name: string; content: string },
) {
  const chapter = file.name.replace(/\.rpy$/i, '');
  const { document, nodes: tokenTree } = await renpyParse(file.content);
  const flat = tokenTree.flatten();
  const scanState = createScanState();

  for (const tok of flat) {
    const type = tok.type as number;
    const meta = analyzeTokenMeta(tok.metaTokens as Iterable<number>);
    let tokenText: string | undefined;
    const val = (): string => {
      if (tokenText === undefined) tokenText = tok.getValue(document);
      return tokenText;
    };
    const menuDepth = meta.menuDepth;

    maybeUpdateConditionalState(scanState, type, val, tok.startPos.character);

    if (type === PARSER_TOKENS.kwLabel && meta.hasLabelStatement) {
      scanState.waitForLabelName = true;
      scanState.menuStack.length = 0;
      scanState.conditionalIndentStack.length = 0;
      scanState.waitForJumpTarget = false;
      scanState.waitForCallTarget = false;
      scanState.waitForMenuNameForId = null;
      continue;
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
      continue;
    }

    if (scanState.currentLabelId === null) continue;

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
      }

      scanState.menuStack.push({ id: newMenuId, optionText: null });
      assertInvariant(
        scanState.menuStack.length <= menuDepth,
        `menu stack depth exceeded menu meta depth (${scanState.menuStack.length} > ${menuDepth})`,
      );

      if (scanState.conditionalIndentStack.length === 0) {
        scanState.labelHasExplicitExit = true;
      }
      continue;
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
      continue;
    }

    if (
      type === PARSER_TOKENS.literalString &&
      meta.hasMenuOption &&
      meta.hasMenuBlock
    ) {
      const menu = menuAtDepth(scanState.menuStack, menuDepth);
      if (menu) menu.optionText = val();
      continue;
    }

    if (type === PARSER_TOKENS.kwJump && meta.hasJumpStatement) {
      scanState.waitForJumpTarget = true;
      continue;
    }

    if (
      type === PARSER_TOKENS.entityFunctionName &&
      scanState.waitForJumpTarget &&
      meta.hasJumpStatement
    ) {
      const target = val();
      const isInOption = meta.hasMenuOptionBlock;
      const menu = menuAtDepth(scanState.menuStack, menuDepth);
      const source = isInOption && menu ? menu.id : scanState.currentLabelId;
      const optionText = menu?.optionText ?? null;
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
      if (!isInOption && scanState.conditionalIndentStack.length === 0) {
        scanState.labelHasExplicitExit = true;
      }
      scanState.waitForJumpTarget = false;
      continue;
    }

    if (type === PARSER_TOKENS.kwCall && meta.hasCallStatement) {
      scanState.waitForCallTarget = true;
      continue;
    }

    if (
      type === PARSER_TOKENS.entityFunctionName &&
      scanState.waitForCallTarget &&
      meta.hasCallStatement
    ) {
      const target = val();
      const isInOption = meta.hasMenuOptionBlock;
      const menu = menuAtDepth(scanState.menuStack, menuDepth);
      const source = isInOption && menu ? menu.id : scanState.currentLabelId;
      const optionText = menu?.optionText ?? null;
      if (source) {
        addEdge(state, {
          id: `call_${source}__${target}_${optionText ?? ''}`,
          source,
          target,
          kind: 'call',
          label: isInOption ? (optionText ? `call: ${optionText}` : 'call') : 'call',
        });
      }

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

      scanState.waitForCallTarget = false;
      continue;
    }

    if (type === PARSER_TOKENS.kwReturn && !meta.hasMenuOptionBlock) {
      scanState.labelHasExplicitExit = true;
      state.hasReturnInLabel.add(scanState.currentLabelId);
      continue;
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
          if (ownerNode) ownerNode.dialogueCount += 1;
        }
      }
    }
  }
}
