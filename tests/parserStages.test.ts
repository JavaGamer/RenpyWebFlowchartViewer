import { describe, expect, it } from 'vitest';
import { analyzeTokenMeta } from '../src/parser/tokenMeta';
import { PARSER_TOKENS } from '../src/parserTokens';
import { createGraphState } from '../src/parser/pipelineState';
import { finalizeRoles } from '../src/parser/roleFinalization';
import { addNode, addOutgoing, addIncoming } from '../src/parser/graphMutations';
import { handleToken } from '../src/parser/tokenHandling';
import { materializeCallReturnEdges } from '../src/parser/callReturnFinalization';
import { classifyNodeRole } from '../src/parser/roleClassification';
import { processFlatToken, processFlatTokens } from '../src/parser/tokenScanStage';
import { TextDocument } from 'vscode-languageserver-textdocument';

describe('parser stage modules', () => {
  it('analyzes token meta flags correctly', () => {
    const flags = analyzeTokenMeta([
      PARSER_TOKENS.metaMenuStatement,
      PARSER_TOKENS.metaMenuOption,
      PARSER_TOKENS.metaCallStatement,
    ]);
    expect(flags.menuDepth).toBe(1);
    expect(flags.hasMenuStatement).toBe(true);
    expect(flags.hasMenuOption).toBe(true);
    expect(flags.hasCallStatement).toBe(true);
    expect(flags.hasJumpStatement).toBe(false);
  });

  it('finalizes menu node role as menu', () => {
    const state = createGraphState();
    addNode(state, {
      id: 'menu_1',
      type: 'MENU',
      label: 'menu_1',
      dialogueCount: 0,
      chapter: 'ch',
      parentLabelId: 'start',
    });
    finalizeRoles(state);
    expect(state.nodes[0]?.role).toBe('menu');
  });

  it('token handler resets scan waits when label keyword is observed', () => {
    const state = createGraphState();
    const scanState = {
      currentLabelId: 'start',
      menuStack: [{ id: 'menu_1', optionText: null as string | null }],
      conditionalIndentStack: [2],
      labelHasExplicitExit: false,
      waitForLabelName: false,
      waitForJumpTarget: true,
      waitForCallTarget: true,
      waitForMenuNameForId: 'menu_1',
    };

    handleToken(state, scanState, {
      type: PARSER_TOKENS.kwLabel,
      meta: {
        menuDepth: 0,
        hasLabelStatement: true,
        hasMenuStatement: false,
        hasMenuBlock: false,
        hasMenuOption: false,
        hasMenuOptionBlock: false,
        hasJumpStatement: false,
        hasCallStatement: false,
        hasSayNarrator: false,
        hasSayCharacter: false,
        hasSayStatement: false,
      },
      val: () => '',
      chapter: 'ch',
      menuDepth: 0,
    });

    expect(scanState.waitForLabelName).toBe(true);
    expect(scanState.waitForJumpTarget).toBe(false);
    expect(scanState.waitForCallTarget).toBe(false);
    expect(scanState.waitForMenuNameForId).toBeNull();
    expect(scanState.menuStack).toHaveLength(0);
    expect(scanState.conditionalIndentStack).toHaveLength(0);
  });

  it('materializes call return edges from pending call-return pairs', () => {
    const state = createGraphState();
    state.pendingCallReturns.push({ callerLabelId: 'caller', callTargetId: 'callee' });

    materializeCallReturnEdges(state);

    expect(state.edges).toContainEqual(
      expect.objectContaining({
        id: 'ret_callee__caller',
        source: 'callee',
        target: 'caller',
        kind: 'call_return',
        label: 'return',
      }),
    );
  });

  it('classifies utility role for called labels with return and no story traffic', () => {
    const state = createGraphState();
    addNode(state, {
      id: 'util_label',
      type: 'LABEL',
      label: 'util_label',
      dialogueCount: 0,
      chapter: 'ch',
    });
    state.calledLabels.add('util_label');
    state.hasReturnInLabel.add('util_label');

    const node = state.nodes[0]!;
    expect(classifyNodeRole(state, node)).toBe('utility');
  });

  it('classifies story role when sequence traffic exists', () => {
    const state = createGraphState();
    addNode(state, {
      id: 'story_label',
      type: 'LABEL',
      label: 'story_label',
      dialogueCount: 0,
      chapter: 'ch',
    });
    addOutgoing(state, 'story_label', 'sequence');
    addIncoming(state, 'story_label', 'sequence');
    state.hasReturnInLabel.add('story_label');
    state.calledLabels.add('story_label');

    const node = state.nodes[0]!;
    expect(classifyNodeRole(state, node)).toBe('story');
  });

  it('processFlatToken delegates conditional updates and token handling', () => {
    const state = createGraphState();
    const scanState = {
      currentLabelId: null as string | null,
      menuStack: [],
      conditionalIndentStack: [],
      labelHasExplicitExit: false,
      waitForLabelName: false,
      waitForJumpTarget: true,
      waitForCallTarget: true,
      waitForMenuNameForId: 'menu_1',
    };
    const doc = TextDocument.create('file://t.rpy', 'rpy', 1, 'label start:\n');

    processFlatToken(
      state,
      scanState,
      {
        type: PARSER_TOKENS.kwLabel,
        metaTokens: [PARSER_TOKENS.metaLabelStatement],
        startPos: { character: 0 },
        getValue: () => 'label',
      },
      doc,
      'ch',
    );

    expect(scanState.waitForLabelName).toBe(true);
    expect(scanState.waitForJumpTarget).toBe(false);
    expect(scanState.waitForCallTarget).toBe(false);
    expect(scanState.waitForMenuNameForId).toBeNull();
  });

  it('processFlatTokens processes token stream in order', () => {
    const state = createGraphState();
    const scanState = {
      currentLabelId: null as string | null,
      menuStack: [],
      conditionalIndentStack: [],
      labelHasExplicitExit: false,
      waitForLabelName: false,
      waitForJumpTarget: false,
      waitForCallTarget: false,
      waitForMenuNameForId: null as string | null,
    };
    const doc = TextDocument.create('file://t.rpy', 'rpy', 1, 'label start:\n');

    processFlatTokens(
      state,
      scanState,
      [
        {
          type: PARSER_TOKENS.kwLabel,
          metaTokens: [PARSER_TOKENS.metaLabelStatement],
          startPos: { character: 0 },
          getValue: () => 'label',
        },
        {
          type: PARSER_TOKENS.entityFunctionName,
          metaTokens: [PARSER_TOKENS.metaLabelStatement],
          startPos: { character: 6 },
          getValue: () => 'start',
        },
      ],
      doc,
      'ch',
    );

    expect(state.nodeMap.has('start')).toBe(true);
    expect(scanState.currentLabelId).toBe('start');
  });
});
