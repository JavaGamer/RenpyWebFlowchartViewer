import { describe, expect, it } from 'vitest';
import { analyzeTokenMeta } from '../src/parser/tokenMeta';
import { PARSER_TOKENS } from '../src/parserTokens';
import { createGraphState } from '../src/parser/pipelineState';
import { finalizeRoles } from '../src/parser/roleFinalization';
import { addNode } from '../src/parser/graphMutations';
import { handleToken } from '../src/parser/tokenHandling';

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
});
