import { describe, expect, it } from 'vitest';
import { analyzeTokenMeta } from '../src/parser/tokenMeta';
import { PARSER_TOKENS } from '../src/parserTokens';
import { createGraphState } from '../src/parser/pipelineState';
import { finalizeRoles } from '../src/parser/roleFinalization';
import { addNode } from '../src/parser/graphMutations';

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
});
