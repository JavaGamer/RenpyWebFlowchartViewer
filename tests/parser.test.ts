import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseRenpyFiles } from '../src/parser';

function loadFixture(name: string): string {
  const fixturesDir = resolve(import.meta.dirname, 'fixtures');
  return readFileSync(resolve(fixturesDir, name), 'utf8');
}

describe('parseRenpyFiles', () => {
  it('returns an empty graph when no files are provided', async () => {
    await expect(parseRenpyFiles([])).resolves.toEqual({ nodes: [], edges: [] });
  });

  it('parses basic labels, dialogue, and fallthrough sequence edges', async () => {
    const script = [
      'label start:',
      '    "hello"',
      '',
      'label second:',
      '    e "hi"',
      '',
    ].join('\n');

    const result = await parseRenpyFiles([{ name: 'basic.rpy', content: script }]);

    expect(result.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'start',
          type: 'LABEL',
          label: 'start',
          dialogueCount: 1,
        }),
        expect.objectContaining({
          id: 'second',
          type: 'LABEL',
          label: 'second',
          dialogueCount: 1,
        }),
      ]),
    );

    expect(result.edges).toContainEqual({
      id: 'seq_start__second',
      source: 'start',
      target: 'second',
      kind: 'sequence',
      label: 'next',
    });
  });

  it('deduplicates nodes and sequence edges across multiple files while aggregating dialogue counts', async () => {
    const files = [
      {
        name: 'part1.rpy',
        content: [
          'label alpha:',
          '    "line a1"',
          '',
          'label beta:',
          '    "line b1"',
          '',
        ].join('\n'),
      },
      {
        name: 'part2.rpy',
        content: [
          'label alpha:',
          '    "line a2"',
          '',
          'label beta:',
          '    "line b2"',
          '',
        ].join('\n'),
      },
    ];

    const result = await parseRenpyFiles(files);

    const alphaNodes = result.nodes.filter((n) => n.id === 'alpha');
    const downstreamNodes = result.nodes.filter((n) => n.id !== 'alpha');
    expect(alphaNodes).toHaveLength(1);
    expect(downstreamNodes).toHaveLength(1);
    expect(alphaNodes[0]).toEqual(
      expect.objectContaining({ dialogueCount: 2 }),
    );
    expect(downstreamNodes[0]).toEqual(
      expect.objectContaining({ dialogueCount: 2 }),
    );

    const sequenceEdges = result.edges.filter((e) => e.source === 'alpha');
    expect(sequenceEdges).toHaveLength(1);
    expect(sequenceEdges[0]).toEqual(
      expect.objectContaining({
        source: 'alpha',
        target: downstreamNodes[0]?.id,
        label: 'next',
      }),
    );
  });

  it('keeps parse output stable across repeated invocations for the same input', async () => {
    const files = [
      {
        name: 'repeat.rpy',
        content: [
          'label one:',
          '    "line 1"',
          '',
          'label two:',
          '    "line 2"',
          '',
        ].join('\n'),
      },
    ];

    const first = await parseRenpyFiles(files);
    const second = await parseRenpyFiles(files);

    expect(second).toEqual(first);
  });

  // ── Label parsing ────────────────────────────────────────────────────────────

  it('parses a single label with no dialogue', async () => {
    const script = 'label intro:\n    pass\n';

    const result = await parseRenpyFiles([{ name: 'intro.rpy', content: script }]);

    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0]).toEqual(
      expect.objectContaining({ id: 'intro', type: 'LABEL', label: 'intro', dialogueCount: 0 }),
    );
    expect(result.edges).toHaveLength(0);
  });

  it('accumulates multiple dialogue lines in the same label', async () => {
    const script = [
      'label scene:',
      '    "line one"',
      '    "line two"',
      '    "line three"',
      '',
    ].join('\n');

    const result = await parseRenpyFiles([{ name: 'scene.rpy', content: script }]);

    const node = result.nodes.find((n) => n.id === 'scene');
    expect(node).toBeDefined();
    expect(node?.dialogueCount).toBe(3);
    expect(node?.dialogueLines).toEqual(['line one', 'line two', 'line three']);
  });

  it('supports count-only dialogue mode for faster parse without line capture', async () => {
    const script = [
      'label scene:',
      '    "line one"',
      '    "line two"',
      '',
    ].join('\n');

    const result = await parseRenpyFiles(
      [{ name: 'scene.rpy', content: script }],
      { captureDialogueLines: false },
    );

    const node = result.nodes.find((n) => n.id === 'scene');
    expect(node).toBeDefined();
    expect(node?.dialogueCount).toBe(2);
    expect(node?.dialogueLines).toBeUndefined();
  });

  // ── Menu detection ───────────────────────────────────────────────────────────

  it('parses an unnamed menu and creates a MENU node with a sequence edge from its parent label', async () => {
    const script = [
      'label choice:',
      '    menu:',
      '        "Option A":',
      '            jump end_a',
      '        "Option B":',
      '            jump end_b',
      '',
      'label end_a:',
      '    "done a"',
      '',
      'label end_b:',
      '    "done b"',
      '',
    ].join('\n');

    const result = await parseRenpyFiles([{ name: 'menu.rpy', content: script }]);

    const menuNode = result.nodes.find((n) => n.type === 'MENU');
    expect(menuNode).toBeDefined();

    // There must be a sequence edge from the parent label to the menu node
    const labelToMenu = result.edges.find(
      (e) => e.source === 'choice' && e.target === menuNode?.id,
    );
    expect(labelToMenu).toBeDefined();
  });

  it('parses a named menu and uses the provided name as the menu node label', async () => {
    const script = [
      'label hub:',
      '    menu talk_options:',
      '        "Ask A":',
      '            jump dest_a',
      '        "Ask B":',
      '            jump dest_b',
      '',
      'label dest_a:',
      '    "a"',
      '',
      'label dest_b:',
      '    "b"',
      '',
    ].join('\n');

    const result = await parseRenpyFiles([{ name: 'named_menu.rpy', content: script }]);

    const menuNode = result.nodes.find((n) => n.type === 'MENU');
    expect(menuNode).toBeDefined();
    expect(menuNode?.label).toBe('talk_options');
  });

  it('does not count menu option strings as dialogue', async () => {
    const script = [
      'label pick:',
      '    menu:',
      '        "Option A":',
      '            jump end',
      '        "Option B":',
      '            jump end',
      '',
      'label end:',
      '    "fin"',
      '',
    ].join('\n');

    const result = await parseRenpyFiles([{ name: 'menu_opts.rpy', content: script }]);

    const pickNode = result.nodes.find((n) => n.id === 'pick');
    expect(pickNode?.dialogueCount).toBe(0);
  });

  // ── Jump parsing ─────────────────────────────────────────────────────────────

  it('parses a jump statement and creates a directed jump edge', async () => {
    const script = [
      'label start:',
      '    jump finish',
      '',
      'label finish:',
      '    "the end"',
      '',
    ].join('\n');

    const result = await parseRenpyFiles([{ name: 'jump.rpy', content: script }]);

    const jumpEdge = result.edges.find(
      (e) => e.source === 'start' && e.target === 'finish',
    );
    expect(jumpEdge).toBeDefined();
    expect(jumpEdge?.id).toMatch(/^jump_/);
  });

  it('jump prevents a fallthrough sequence edge to the next label', async () => {
    const script = [
      'label a:',
      '    jump c',
      '',
      'label b:',
      '    "b"',
      '',
      'label c:',
      '    "c"',
      '',
    ].join('\n');

    const result = await parseRenpyFiles([{ name: 'jump_no_fallthrough.rpy', content: script }]);

    const fallthroughEdge = result.edges.find(
      (e) => e.source === 'a' && e.target === 'b' && e.label === 'next',
    );
    expect(fallthroughEdge).toBeUndefined();
  });

  it('creates a jump edge with the menu option text as label when jump is inside a menu option', async () => {
    const script = [
      'label decide:',
      '    menu:',
      '        "Go north":',
      '            jump north',
      '        "Go south":',
      '            jump south',
      '',
      'label north:',
      '    "north"',
      '',
      'label south:',
      '    "south"',
      '',
    ].join('\n');

    const result = await parseRenpyFiles([{ name: 'menu_jump.rpy', content: script }]);

    const northEdge = result.edges.find((e) => e.target === 'north');
    const southEdge = result.edges.find((e) => e.target === 'south');

    expect(northEdge).toBeDefined();
    expect(northEdge?.label).toBe('Go north');

    expect(southEdge).toBeDefined();
    expect(southEdge?.label).toBe('Go south');
  });

  it('adds a menu fallthrough sequence edge when menu options do not jump/call', async () => {
    const script = [
      'label decide:',
      '    menu:',
      '        "Go north":',
      '            "You walk north for a bit."',
      '        "Go south":',
      '            "You walk south for a bit."',
      '',
      'label after_menu:',
      '    "after"',
      '',
    ].join('\n');

    const result = await parseRenpyFiles([{ name: 'menu_fallthrough.rpy', content: script }]);
    const menuNode = result.nodes.find((n) => n.type === 'MENU');

    expect(result.edges).toContainEqual(
      expect.objectContaining({ source: menuNode?.id, target: 'after_menu', kind: 'sequence', label: 'next' }),
    );
  });

  it('adds a menu fallthrough edge to the next menu when prior options have no explicit exit', async () => {
    const script = [
      'label decide:',
      '    menu:',
      '        "Talk":',
      '            "You chat a bit."',
      '',
      '    menu:',
      '        "Leave":',
      '            jump end',
      '',
      'label end:',
      '    "done"',
      '',
    ].join('\n');

    const result = await parseRenpyFiles([{ name: 'menu_to_menu_fallthrough.rpy', content: script }]);
    const menus = result.nodes.filter((n) => n.type === 'MENU');
    expect(menus).toHaveLength(2);

    expect(result.edges).toContainEqual(
      expect.objectContaining({ source: menus[0]?.id, target: menus[1]?.id, kind: 'sequence', label: 'next' }),
    );
  });

  it('keeps nested menu jumps attached to the nested menu node and option text', async () => {
    const script = [
      'label start:',
      '    menu:',
      '        "Outer":',
      '            menu:',
      '                "Inner":',
      '                    jump inner_dest',
      '',
      'label inner_dest:',
      '    "done"',
      '',
    ].join('\n');

    const result = await parseRenpyFiles([{ name: 'nested_menu_source.rpy', content: script }]);

    const menuNodes = result.nodes.filter((n) => n.type === 'MENU');
    expect(menuNodes).toHaveLength(2);

    const innerJump = result.edges.find((e) => e.target === 'inner_dest' && e.id.startsWith('jump_'));
    expect(innerJump).toBeDefined();
    expect(innerJump?.label).toBe('Inner');
    expect(menuNodes.some((n) => n.id === innerJump?.source)).toBe(true);
  });

  it('uses stable edge IDs when a menu option text is not yet available', async () => {
    const script = [
      'label choice:',
      '    menu:',
      '        "Option A":',
      '            jump end_a',
      '',
      'label end_a:',
      '    "done"',
      '',
    ].join('\n');

    const result = await parseRenpyFiles([{ name: 'unnamed_menu_edge_id.rpy', content: script }]);

    const seqEdge = result.edges.find((e) => e.source === 'choice' && e.target.startsWith('menu_'));
    expect(seqEdge).toBeDefined();
    expect(seqEdge?.id).toBe(`seq_choice__${seqEdge?.target}`);
  });

  // ── Call parsing ─────────────────────────────────────────────────────────────

  it('parses a call statement and creates a directed call edge labeled "call"', async () => {
    const script = [
      'label main:',
      '    call subroutine',
      '    "back from sub"',
      '',
      'label subroutine:',
      '    "in sub"',
      '    return',
      '',
    ].join('\n');

    const result = await parseRenpyFiles([{ name: 'call.rpy', content: script }]);

    const callEdge = result.edges.find(
      (e) => e.source === 'main' && e.target === 'subroutine',
    );
    expect(callEdge).toBeDefined();
    expect(callEdge?.id).toMatch(/^call_/);
    expect(callEdge?.label).toBe('call');
    expect(callEdge?.kind).toBe('call');
  });

  it('call does not prevent a fallthrough sequence edge to the next label', async () => {
    const script = [
      'label caller:',
      '    call helper',
      '',
      'label after_caller:',
      '    "after"',
      '',
      'label helper:',
      '    "help"',
      '    return',
      '',
    ].join('\n');

    const result = await parseRenpyFiles([{ name: 'call_fallthrough.rpy', content: script }]);

    const fallthroughEdge = result.edges.find(
      (e) => e.source === 'caller' && e.target === 'after_caller' && e.label === 'next',
    );
    expect(fallthroughEdge).toBeDefined();
  });

  it('does not suppress fallthrough when jump is inside a conditional branch', async () => {
    const script = [
      'label start:',
      '    if flag:',
      '        jump branch_a',
      '    "continue"',
      '',
      'label next_label:',
      '    "after conditional"',
      '',
      'label branch_a:',
      '    "branch"',
      '',
    ].join('\n');

    const result = await parseRenpyFiles([{ name: 'conditional_jump.rpy', content: script }]);

    const decisionNode = result.nodes.find((node) => node.type === 'DECISION');
    expect(decisionNode).toBeDefined();
    expect(result.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: 'start', target: decisionNode?.id, kind: 'sequence' }),
        expect.objectContaining({
          source: decisionNode?.id,
          target: 'branch_a',
          kind: 'jump',
          condition: expect.objectContaining({ branchKind: 'if', expression: 'flag' }),
        }),
        expect.objectContaining({ source: 'start', target: 'next_label', label: 'next' }),
      ]),
    );
  });

  it('does not suppress fallthrough when menu is inside a conditional branch', async () => {
    const script = [
      'label start:',
      '    if flag:',
      '        menu:',
      '            "Go to branch":',
      '                jump branch_a',
      '    "continue"',
      '',
      'label next_label:',
      '    "after conditional"',
      '',
      'label branch_a:',
      '    "branch"',
      '',
    ].join('\n');

    const result = await parseRenpyFiles([{ name: 'conditional_menu.rpy', content: script }]);

    expect(result.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: 'menu_1', target: 'branch_a', kind: 'jump' }),
        expect.objectContaining({ source: 'start', target: 'next_label', label: 'next' }),
      ]),
    );
  });

  it('does not suppress fallthrough when return is inside a conditional branch', async () => {
    const script = [
      'label start:',
      '    if flag:',
      '        return',
      '    "continue"',
      '',
      'label next_label:',
      '    "after conditional"',
      '',
    ].join('\n');

    const result = await parseRenpyFiles([{ name: 'conditional_return.rpy', content: script }]);

    expect(result.edges).toContainEqual(
      expect.objectContaining({ source: 'start', target: 'next_label', kind: 'sequence', label: 'next' }),
    );
  });

  it('emits an explicit decision node and conditional branch metadata for if/elif/else', async () => {
    const script = [
      'label start:',
      '    if flag_a:  # branch A',
      '        jump branch_a',
      '    elif flag_b:  # branch B',
      '        jump branch_b',
      '    else:  # fallback',
      '        jump branch_c',
      '',
      'label branch_a:',
      '    "A"',
      '',
      'label branch_b:',
      '    "B"',
      '',
      'label branch_c:',
      '    "C"',
      '',
    ].join('\n');

    const result = await parseRenpyFiles([{ name: 'conditional_branches.rpy', content: script }]);
    const decisionNode = result.nodes.find((node) => node.type === 'DECISION');
    expect(decisionNode).toBeDefined();

    const conditionalJumpEdges = result.edges.filter((edge) => edge.source === decisionNode?.id && edge.kind === 'jump');
    expect(conditionalJumpEdges).toHaveLength(3);
    expect(conditionalJumpEdges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          target: 'branch_a',
          condition: expect.objectContaining({
            branchKind: 'if',
            expression: 'flag_a',
            references: ['flag_a'],
          }),
        }),
        expect.objectContaining({
          target: 'branch_b',
          condition: expect.objectContaining({
            branchKind: 'elif',
            expression: 'flag_b',
            references: ['flag_b'],
          }),
        }),
        expect.objectContaining({
          target: 'branch_c',
          condition: expect.objectContaining({
            branchKind: 'else',
          }),
        }),
      ]),
    );
  });

  it('creates a call edge labeled with the option text when call is inside a menu option', async () => {
    const script = [
      'label hub:',
      '    menu:',
      '        "Talk to Alice":',
      '            call alice_scene',
      '',
      'label alice_scene:',
      '    "hello"',
      '    return',
      '',
    ].join('\n');

    const result = await parseRenpyFiles([{ name: 'menu_call.rpy', content: script }]);

    const callEdge = result.edges.find((e) => e.target === 'alice_scene');
    expect(callEdge).toBeDefined();
    expect(callEdge?.label).toBe('call: Talk to Alice');
  });

  it('adds synthetic call-return edges from called label back to caller label', async () => {
    const script = [
      'label main:',
      '    call helper',
      '',
      'label helper:',
      '    "in helper"',
      '    return',
      '',
    ].join('\n');

    const result = await parseRenpyFiles([{ name: 'call_return.rpy', content: script }]);
    expect(result.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'main',
          target: 'helper',
          kind: 'call',
        }),
        expect.objectContaining({
          source: 'helper',
          target: 'main',
          kind: 'call_return',
          label: 'return',
        }),
      ]),
    );
  });

  it('does not add call-return edges when a callee only returns conditionally', async () => {
    const script = [
      'label main:',
      '    call helper',
      '',
      'label helper:',
      '    if flag:',
      '        return',
      '    "continue"',
      '',
      'label after_helper:',
      '    "done"',
      '',
    ].join('\n');

    const result = await parseRenpyFiles([{ name: 'conditional-call-return.rpy', content: script }]);

    expect(result.edges).toContainEqual(
      expect.objectContaining({ source: 'main', target: 'helper', kind: 'call' }),
    );
    expect(result.edges.find((e) => e.kind === 'call_return' && e.source === 'helper' && e.target === 'main')).toBeUndefined();
  });

  it('classifies label roles using strict rules and keeps role metadata on nodes', async () => {
    const script = [
      'label main:',
      '    menu:',
      '        "Talk":',
      '            call detour_scene',
      '',
      'label detour_scene:',
      '    "detour"',
      '    return',
      '',
      'label helper_only:',
      '    "utility"',
      '    return',
      '',
      'label state_toggle:',
      '    return',
      '',
    ].join('\n');

    const result = await parseRenpyFiles([{ name: 'roles.rpy', content: script }]);
    const byId = new Map(result.nodes.map((n) => [n.id, n]));
    expect(byId.get('main')?.role).toBe('story');
    expect(byId.get('detour_scene')?.role).toBe('detour');
    expect(byId.get('helper_only')?.role).toBe('state_toggle');
    const menuNode = result.nodes.find((n) => n.type === 'MENU');
    expect(menuNode?.role).toBe('menu');
  });

  // ── Dialogue extraction ───────────────────────────────────────────────────────

  it('counts narrator dialogue (no character prefix)', async () => {
    const script = [
      'label narration:',
      '    "narrator speaks"',
      '    "again"',
      '',
    ].join('\n');

    const result = await parseRenpyFiles([{ name: 'narrator.rpy', content: script }]);

    const node = result.nodes.find((n) => n.id === 'narration');
    expect(node?.dialogueCount).toBe(2);
  });

  it('counts character dialogue (character name prefix)', async () => {
    const script = [
      'label scene:',
      '    e "hello there"',
      '    m "hi!"',
      '',
    ].join('\n');

    const result = await parseRenpyFiles([{ name: 'char_dialogue.rpy', content: script }]);

    const node = result.nodes.find((n) => n.id === 'scene');
    expect(node?.dialogueCount).toBe(2);
  });

  it('attributes dialogue inside a menu option block to the menu node', async () => {
    const script = [
      'label explain:',
      '    menu:',
      '        "Ask A":',
      '            e "answering A"',
      '            jump done',
      '',
      'label done:',
      '    "done"',
      '',
    ].join('\n');

    const result = await parseRenpyFiles([{ name: 'menu_dialogue.rpy', content: script }]);

    const menuNode = result.nodes.find((n) => n.type === 'MENU');
    expect(menuNode).toBeDefined();
    expect(menuNode?.dialogueCount).toBe(1);

    const labelNode = result.nodes.find((n) => n.id === 'explain');
    expect(labelNode?.dialogueCount).toBe(0);
  });

  // ── Return keyword ───────────────────────────────────────────────────────────

  it('return prevents a fallthrough sequence edge to the next label', async () => {
    const script = [
      'label first:',
      '    "say something"',
      '    return',
      '',
      'label second:',
      '    "never reached via fallthrough"',
      '',
    ].join('\n');

    const result = await parseRenpyFiles([{ name: 'return.rpy', content: script }]);

    const fallthroughEdge = result.edges.find(
      (e) => e.source === 'first' && e.target === 'second' && e.label === 'next',
    );
    expect(fallthroughEdge).toBeUndefined();
  });

  // ── Fixture-based regression cases ───────────────────────────────────────────

  it('fixture: nested menus preserve menu-option jump edges, including nested options', async () => {
    const result = await parseRenpyFiles([
      { name: 'nested-menus.rpy', content: loadFixture('nested-menus.rpy') },
    ]);

    const menuNodes = result.nodes.filter((n) => n.type === 'MENU');
    expect(menuNodes).toHaveLength(2);
    expect(menuNodes.map((n) => n.id)).toEqual(['menu_1', 'menu_2']);

    expect(result.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: 'start', target: 'menu_1' }),
        expect.objectContaining({ source: 'menu_1', target: 'menu_2', label: 'Ask about quest' }),
      ]),
    );

    const acceptedEdge = result.edges.find((e) => e.target === 'accepted' && e.label === 'Accept quest');
    const declinedViaNested = result.edges.find((e) => e.target === 'declined' && e.label === 'Decline quest');
    const declinedDirect = result.edges.find((e) => e.target === 'declined' && e.label === 'Leave');

    expect(acceptedEdge).toBeDefined();
    expect(declinedViaNested).toBeDefined();
    expect(declinedDirect).toBeDefined();
  });

  it('fixture: unreachable labels are still emitted as nodes and keep normal sequence/jump behavior', async () => {
    const result = await parseRenpyFiles([
      { name: 'unreachable-labels.rpy', content: loadFixture('unreachable-labels.rpy') },
    ]);

    expect(result.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'start', type: 'LABEL' }),
        expect.objectContaining({ id: 'hidden_branch', type: 'LABEL' }),
        expect.objectContaining({ id: 'finish', type: 'LABEL' }),
      ]),
    );

    expect(result.edges).toContainEqual(
      expect.objectContaining({ source: 'start', target: 'finish' }),
    );
    expect(result.edges).toContainEqual(
      expect.objectContaining({ source: 'hidden_branch', target: 'finish', label: 'next' }),
    );
  });

  it('fixture: cyclic jumps are represented as explicit jump edges in both directions', async () => {
    const result = await parseRenpyFiles([
      { name: 'cyclic-jumps.rpy', content: loadFixture('cyclic-jumps.rpy') },
    ]);

    expect(result.edges).toContainEqual(
      expect.objectContaining({ source: 'loop_a', target: 'loop_b' }),
    );
    expect(result.edges).toContainEqual(
      expect.objectContaining({ source: 'loop_b', target: 'loop_a' }),
    );
  });

  it('fixture: malformed script recovery preserves parsable labels and does not throw', async () => {
    await expect(
      parseRenpyFiles([
        {
          name: 'malformed-script-recovery.rpy',
          content: loadFixture('malformed-script-recovery.rpy'),
        },
      ]),
    ).resolves.toEqual(
      expect.objectContaining({
        nodes: expect.arrayContaining([
          expect.objectContaining({ id: 'start', type: 'LABEL' }),
          expect.objectContaining({ id: 'fallback', type: 'LABEL' }),
        ]),
        edges: expect.arrayContaining([
          expect.objectContaining({ source: 'start', target: 'fallback' }),
        ]),
      }),
    );
  });

  it('fixture: extracts direct renpy.jump/renpy.call from python blocks and over-approximates loop/state control flow', async () => {
    const result = await parseRenpyFiles([
      { name: 'direct-renpy-api.rpy', content: loadFixture('direct-renpy-api.rpy') },
    ]);

    expect(result.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: 'start', target: 'jump_target', kind: 'jump' }),
        expect.objectContaining({ source: 'start', target: 'loop_target', kind: 'jump' }),
        expect.objectContaining({ source: 'start', target: 'call_target', kind: 'call' }),
        expect.objectContaining({ source: 'start', target: 'next_label', kind: 'sequence', label: 'next' }),
      ]),
    );
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'dynamic_target',
          severity: 'warning',
          location: expect.objectContaining({
            chapter: 'direct-renpy-api',
            construct: 'renpy.call',
            targetExpression: 'dynamic_target',
          }),
        }),
      ]),
    );
  });

  it('does not treat non-direct identifiers like myrenpy.call as direct renpy API calls', async () => {
    const script = [
      'label start:',
      '    python:',
      '        myrenpy.call("target")',
      '',
      'label target:',
      '    "target"',
      '',
    ].join('\n');
    const result = await parseRenpyFiles([{ name: 'not-direct-renpy.rpy', content: script }]);
    expect(result.edges.find((e) => e.kind === 'call' && e.source === 'start' && e.target === 'target')).toBeUndefined();
  });

  it('fixture: extracts direct screen action Jump/Call targets and warns on dynamic action targets', async () => {
    const result = await parseRenpyFiles([
      { name: 'direct-screen-actions.rpy', content: loadFixture('direct-screen-actions.rpy') },
    ]);

    expect(result.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: 'start', target: 'jump_target', kind: 'jump' }),
        expect.objectContaining({ source: 'start', target: 'call_target', kind: 'call' }),
      ]),
    );
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'dynamic_target',
          severity: 'warning',
          location: expect.objectContaining({
            chapter: 'direct-screen-actions',
            construct: 'Jump',
            targetExpression: 'dynamic_target',
          }),
        }),
      ]),
    );
  });

  it('ignores top-level python blocks that are outside any active label scope', async () => {
    const script = [
      'python:',
      '    renpy.call("helper")',
      '',
      'label start:',
      '    "hello"',
      '',
      'label helper:',
      '    return',
      '',
    ].join('\n');

    const result = await parseRenpyFiles([{ name: 'global-python.rpy', content: script }]);

    expect(result.edges.find((e) => e.kind === 'call' && e.target === 'helper')).toBeUndefined();
  });

  it('ignores top-level screen blocks instead of attributing them to the previous label', async () => {
    const script = [
      'label start:',
      '    "hello"',
      '',
      'screen chooser():',
      '    textbutton "Go" action Jump("dest")',
      '',
      'label dest:',
      '    return',
      '',
    ].join('\n');

    const result = await parseRenpyFiles([{ name: 'global-screen.rpy', content: script }]);

    expect(result.edges.find((e) => e.kind === 'jump' && e.source === 'start' && e.target === 'dest')).toBeUndefined();
    expect(result.edges).toContainEqual(
      expect.objectContaining({ source: 'start', target: 'dest', kind: 'sequence', label: 'next' }),
    );
  });

  it('does not synthesize action edges from a reused global screen for whichever label was parsed last', async () => {
    const script = [
      'label first:',
      '    show screen chooser',
      '',
      'label second:',
      '    show screen chooser',
      '',
      'screen chooser():',
      '    textbutton "Go" action Call("dest")',
      '',
      'label dest:',
      '    return',
      '',
    ].join('\n');

    const result = await parseRenpyFiles([{ name: 'reused-global-screen.rpy', content: script }]);

    expect(result.edges.find((e) => e.kind === 'call' && e.target === 'dest')).toBeUndefined();
  });

  it('extracts ST variant default action rules', async () => {
    const script = [
      'label start:',
      '    screen route_picker():',
      '        textbutton "Route" action timedchoice("route_one")',
      '        textbutton "Title" action title("title_screen")',
      '',
      'label route_one:',
      '    return',
      '',
      'label title_screen:',
      '    return',
      '',
    ].join('\n');

    const result = await parseRenpyFiles([{ name: 'st-defaults.rpy', content: script }], { parserVariant: 'st' });

    expect(result.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: 'start', target: 'route_one', kind: 'call' }),
        expect.objectContaining({ source: 'start', target: 'title_screen', kind: 'jump' }),
      ]),
    );
  });

  it('applies custom screen action rules on top of defaults', async () => {
    const script = [
      'label start:',
      '    screen route_picker():',
      '        textbutton "Route" action Warp("warp_target")',
      '',
      'label warp_target:',
      '    return',
      '',
    ].join('\n');

    const result = await parseRenpyFiles(
      [{ name: 'custom-screen-rule.rpy', content: script }],
      {
        parserVariant: 'renpy',
        screenActionRules: [{ actionName: 'Warp', actionKind: 'jump' }],
      },
    );

    expect(result.edges).toContainEqual(
      expect.objectContaining({ source: 'start', target: 'warp_target', kind: 'jump' }),
    );
  });

  it('warns instead of inferring dynamic ST variant action targets', async () => {
    const script = [
      'label start:',
      '    screen route_picker():',
      '        textbutton "Route" action timedchoice(dynamic_target)',
      '',
      'label route_one:',
      '    return',
      '',
    ].join('\n');

    const result = await parseRenpyFiles([{ name: 'st-dynamic-target.rpy', content: script }], { parserVariant: 'st' });

    expect(result.edges.find((edge) => edge.target === 'dynamic_target')).toBeUndefined();
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'dynamic_target',
          severity: 'warning',
          location: expect.objectContaining({
            chapter: 'st-dynamic-target',
            construct: 'timedchoice',
            targetExpression: 'dynamic_target',
          }),
        }),
      ]),
    );
  });

  it('extracts direct renpy.jump/renpy.call targets when extra arguments are present', async () => {
    const script = [
      'label start:',
      '    python:',
      '        renpy.jump("jump_target", from_current=True)',
      '        renpy.call("call_target", from_current=True)',
      '',
      'label jump_target:',
      '    return',
      '',
      'label call_target:',
      '    return',
      '',
    ].join('\n');

    const result = await parseRenpyFiles([{ name: 'renpy-extra-args.rpy', content: script }]);

    expect(result.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: 'start', target: 'jump_target', kind: 'jump' }),
        expect.objectContaining({ source: 'start', target: 'call_target', kind: 'call' }),
      ]),
    );
    expect(result.diagnostics ?? []).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ location: expect.objectContaining({ chapter: 'renpy-extra-args', construct: 'renpy.jump' }) }),
        expect.objectContaining({ location: expect.objectContaining({ chapter: 'renpy-extra-args', construct: 'renpy.call' }) }),
      ]),
    );
  });

  it('extracts direct renpy.jump/renpy.call targets when target keyword is not first argument', async () => {
    const script = [
      'label start:',
      '    python:',
      '        renpy.jump(from_current=True, label="jump_target")',
      '        renpy.call(from_current=True, label="call_target")',
      '',
      'label jump_target:',
      '    return',
      '',
      'label call_target:',
      '    return',
      '',
    ].join('\n');

    const result = await parseRenpyFiles([{ name: 'renpy-keyword-order.rpy', content: script }]);

    expect(result.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: 'start', target: 'jump_target', kind: 'jump' }),
        expect.objectContaining({ source: 'start', target: 'call_target', kind: 'call' }),
      ]),
    );
    expect(result.diagnostics ?? []).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ location: expect.objectContaining({ chapter: 'renpy-keyword-order', construct: 'renpy.jump' }) }),
        expect.objectContaining({ location: expect.objectContaining({ chapter: 'renpy-keyword-order', construct: 'renpy.call' }) }),
      ]),
    );
  });

  it('extracts direct screen action targets with keyword and trailing arguments', async () => {
    const script = [
      'label start:',
      '    screen nav_overlay:',
      '        textbutton "Jump A" action Jump("jump_target", from_current=True)',
      '        textbutton "Call B" action Call(label="call_target")',
      '',
      'label jump_target:',
      '    return',
      '',
      'label call_target:',
      '    return',
      '',
    ].join('\n');

    const result = await parseRenpyFiles([{ name: 'screen-extra-args.rpy', content: script }]);

    expect(result.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: 'start', target: 'jump_target', kind: 'jump' }),
        expect.objectContaining({ source: 'start', target: 'call_target', kind: 'call' }),
      ]),
    );
    expect(result.diagnostics ?? []).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ location: expect.objectContaining({ chapter: 'screen-extra-args', construct: 'Jump' }) }),
        expect.objectContaining({ location: expect.objectContaining({ chapter: 'screen-extra-args', construct: 'Call' }) }),
      ]),
    );
  });

  it('extracts direct screen action targets when action uses assignment syntax', async () => {
    const script = [
      'label start:',
      '    screen nav_overlay:',
      '        textbutton "Jump A" action=Jump("jump_target")',
      '        textbutton "Call B" action = Call("call_target")',
      '',
      'label jump_target:',
      '    return',
      '',
      'label call_target:',
      '    return',
      '',
    ].join('\n');

    const result = await parseRenpyFiles([{ name: 'screen-action-assignment.rpy', content: script }]);

    expect(result.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: 'start', target: 'jump_target', kind: 'jump' }),
        expect.objectContaining({ source: 'start', target: 'call_target', kind: 'call' }),
      ]),
    );
  });

  it('extracts multiple screen actions from action list expressions', async () => {
    const script = [
      'label start:',
      '    screen nav_overlay:',
      '        textbutton "Jump A" action [Jump("jump_target"), Call("call_target")]',
      '',
      'label jump_target:',
      '    return',
      '',
      'label call_target:',
      '    return',
      '',
    ].join('\n');

    const result = await parseRenpyFiles([{ name: 'screen-action-list.rpy', content: script }]);

    expect(result.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: 'start', target: 'jump_target', kind: 'jump' }),
        expect.objectContaining({ source: 'start', target: 'call_target', kind: 'call' }),
      ]),
    );
  });

  it('extracts direct renpy.jump/renpy.call targets from non-f-string prefixed literals', async () => {
    const script = [
      'label start:',
      '    python:',
      '        renpy.jump(u"jump_target")',
      '        renpy.call(r"call_target")',
      '',
      'label jump_target:',
      '    return',
      '',
      'label call_target:',
      '    return',
      '',
    ].join('\n');

    const result = await parseRenpyFiles([{ name: 'renpy-prefixed-literals.rpy', content: script }]);

    expect(result.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: 'start', target: 'jump_target', kind: 'jump' }),
        expect.objectContaining({ source: 'start', target: 'call_target', kind: 'call' }),
      ]),
    );
  });

  it('uses the latest earlier same-label python assignment for direct renpy api targets', async () => {
    const script = [
      'label start:',
      '    python:',
      '        route = "first_target"',
      '        route = "second_target"',
      '        renpy.jump(route)',
      '',
      'label first_target:',
      '    return',
      '',
      'label second_target:',
      '    return',
      '',
    ].join('\n');

    const result = await parseRenpyFiles([{ name: 'latest-assignment.rpy', content: script }]);

    expect(result.edges).toContainEqual(
      expect.objectContaining({ source: 'start', target: 'second_target', kind: 'jump' }),
    );
    expect(result.edges.find((edge) => edge.source === 'start' && edge.target === 'first_target' && edge.kind === 'jump')).toBeUndefined();
    expect(result.diagnostics ?? []).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'dynamic_target', location: expect.objectContaining({ construct: 'renpy.jump' }) }),
      ]),
    );
  });

  it('resolves typed python assignments for jump expression and screen action calls', async () => {
    const script = [
      'label start:',
      '    python:',
      '        jump_target: str = "jump_dest"',
      '        call_target: str = "call_dest"',
      '    jump expression jump_target',
      '    screen nav_overlay:',
      '        textbutton "Go Jump" action Jump(jump_target)',
      '        textbutton "Go Call" action Call(call_target)',
      '',
      'label jump_dest:',
      '    return',
      '',
      'label call_dest:',
      '    return',
      '',
    ].join('\n');

    const result = await parseRenpyFiles([{ name: 'typed-targets.rpy', content: script }]);

    expect(result.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: 'start', target: 'jump_dest', kind: 'jump' }),
        expect.objectContaining({ source: 'start', target: 'call_dest', kind: 'call' }),
      ]),
    );
    expect(result.diagnostics ?? []).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'dynamic_target', location: expect.objectContaining({ construct: 'jump expression' }) }),
        expect.objectContaining({ code: 'dynamic_target', location: expect.objectContaining({ construct: 'Jump' }) }),
        expect.objectContaining({ code: 'dynamic_target', location: expect.objectContaining({ construct: 'Call' }) }),
      ]),
    );
  });

  it('invalidates same-label python assignment bindings after a dynamic reassignment', async () => {
    const script = [
      'label start:',
      '    python:',
      '        target = "resolved_dest"',
      '        target = compute_target()',
      '        renpy.call(target)',
      '',
      'label resolved_dest:',
      '    return',
      '',
    ].join('\n');

    const result = await parseRenpyFiles([{ name: 'dynamic-reassign.rpy', content: script }]);

    expect(result.edges.find((edge) => edge.kind === 'call' && edge.source === 'start' && edge.target === 'resolved_dest')).toBeUndefined();
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'dynamic_target',
          location: expect.objectContaining({ construct: 'renpy.call', targetExpression: 'target' }),
        }),
      ]),
    );
  });

  it('does not leak same-label python assignment bindings into later labels', async () => {
    const script = [
      'label start:',
      '    python:',
      '        route = "start_dest"',
      '    return',
      '',
      'label second:',
      '    python:',
      '        renpy.jump(route)',
      '',
      'label start_dest:',
      '    return',
      '',
    ].join('\n');

    const result = await parseRenpyFiles([{ name: 'no-cross-label-leak.rpy', content: script }]);

    expect(result.edges.find((edge) => edge.kind === 'jump' && edge.source === 'second' && edge.target === 'start_dest')).toBeUndefined();
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'dynamic_target',
          location: expect.objectContaining({ construct: 'renpy.jump', targetExpression: 'route' }),
        }),
      ]),
    );
  });

  it('ignores direct call-like patterns inside comments and quoted strings', async () => {
    const script = [
      'label start:',
      '    python:',
      '        "renpy.call(\\"string_target\\")"',
      '        # renpy.jump("comment_target")',
      '    show screen fake_overlay',
      '',
      'screen fake_overlay:',
      '    text "action Jump(\\"text_target\\")"',
      '    # textbutton "Call target" action Call("comment_call_target")',
      '',
      'label end:',
      '    return',
      '',
    ].join('\n');

    const result = await parseRenpyFiles([{ name: 'ignored-direct-call-patterns.rpy', content: script }]);
    const ignoredTargets = new Set(['string_target', 'comment_target', 'text_target', 'comment_call_target']);
    expect(result.edges.some((edge) => ignoredTargets.has(edge.target))).toBe(false);
    expect(result.diagnostics ?? []).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ location: expect.objectContaining({ chapter: 'ignored-direct-call-patterns', construct: 'renpy.jump' }) }),
        expect.objectContaining({ location: expect.objectContaining({ chapter: 'ignored-direct-call-patterns', construct: 'renpy.call' }) }),
        expect.objectContaining({ location: expect.objectContaining({ chapter: 'ignored-direct-call-patterns', construct: 'Jump' }) }),
        expect.objectContaining({ location: expect.objectContaining({ chapter: 'ignored-direct-call-patterns', construct: 'Call' }) }),
      ]),
    );
  });



  it('handles complex conditional nested menu and mixed call/jump flow', async () => {
    const script = [
      'label start:',
      '    if seen_intro:',
      '        menu:',
      '            "Ask mentor":',
      '                call mentor_scene',
      '            "Skip":',
      '                jump end',
      '    "continue"',
      '',
      'label mentor_scene:',
      '    "mentor line"',
      '    return',
      '',
      'label end:',
      '    "done"',
      '',
    ].join('\n');

    const result = await parseRenpyFiles([{ name: 'complex.rpy', content: script }]);

    expect(result.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'call', target: 'mentor_scene' }),
        expect.objectContaining({ kind: 'jump', target: 'end' }),
        expect.objectContaining({ source: 'start', target: 'mentor_scene', kind: 'sequence', label: 'next' }),
      ]),
    );
  });

  it('classifies helper labels as utility when called directly and returning', async () => {
    const script = [
      'label start:',
      '    call helper',
      '    jump end',
      '',
      'label helper:',
      '    "assist"',
      '    return',
      '',
      'label end:',
      '    "done"',
      '',
    ].join('\n');

    const result = await parseRenpyFiles([{ name: 'utility-role.rpy', content: script }]);
    const helper = result.nodes.find((n) => n.id === 'helper');
    expect(helper?.role).toBe('utility');
  });

  it('keeps first node metadata for duplicate labels while aggregating dialogue', async () => {
    const result = await parseRenpyFiles([
      {
        name: 'chapter_one.rpy',
        content: ['label same:', '    "one"', ''].join('\n'),
      },
      {
        name: 'chapter_two.rpy',
        content: ['label same:', '    "two"', ''].join('\n'),
      },
    ]);

    const same = result.nodes.find((n) => n.id === 'same');
    expect(same).toBeDefined();
    expect(same?.chapter).toBe('chapter_one');
    expect(same?.dialogueCount).toBe(2);
  });

  it('uses relative paths to keep duplicate basenames distinct and deterministically ordered', async () => {
    const progressFiles: string[] = [];
    const result = await parseRenpyFiles(
      [
        {
          name: 'script.rpy',
          relativePath: 'routes/beta/script.rpy',
          content: ['label same:', '    "beta"', ''].join('\n'),
        },
        {
          name: 'script.rpy',
          relativePath: 'routes/alpha/script.rpy',
          content: ['label same:', '    "alpha"', ''].join('\n'),
        },
      ],
      {
        onProgress: (progress) => {
          progressFiles.push(progress.currentFile);
        },
      },
    );

    const same = result.nodes.find((n) => n.id === 'same');
    expect(same?.chapter).toBe('routes/alpha/script');
    expect(same?.dialogueCount).toBe(2);
    expect(progressFiles).toEqual(['routes/alpha/script.rpy', 'routes/beta/script.rpy']);
  });

  it('resolves jumps to labels that are defined in a different file', async () => {
    const result = await parseRenpyFiles([
      {
        name: 'part-a.rpy',
        content: ['label intro:', '    jump ending', ''].join('\n'),
      },
      {
        name: 'part-b.rpy',
        content: ['label ending:', '    "done"', ''].join('\n'),
      },
    ]);

    expect(result.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'intro', type: 'LABEL' }),
        expect.objectContaining({ id: 'ending', type: 'LABEL' }),
      ]),
    );
    expect(result.edges).toContainEqual(
      expect.objectContaining({ source: 'intro', target: 'ending' }),
    );
  });

  it('emits unresolved-target warnings for edges targeting missing labels', async () => {
    const result = await parseRenpyFiles([
      {
        name: 'missing-target.rpy',
        content: ['label intro:', '    jump missing_label', ''].join('\n'),
      },
    ]);

    expect(result.edges).toContainEqual(
      expect.objectContaining({ source: 'intro', target: 'missing_label', kind: 'jump' }),
    );
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'unresolved_target',
          severity: 'warning',
          location: expect.objectContaining({
            sourceId: 'intro',
            targetId: 'missing_label',
          }),
        }),
      ]),
    );
  });

  it('preserves output semantics when tokenization is parallelized', async () => {
    const files = [
      {
        name: 'chapter_one.rpy',
        content: ['label same:', '    "one"', '', 'label a:', '    jump z', ''].join('\n'),
      },
      {
        name: 'chapter_two.rpy',
        content: ['label same:', '    "two"', '', 'label z:', '    return', ''].join('\n'),
      },
      {
        name: 'chapter_three.rpy',
        content: ['label k:', '    call z', '', 'label end:', '    "done"', ''].join('\n'),
      },
    ];

    const sequential = await parseRenpyFiles(files);
    const parallel = await parseRenpyFiles(files, { maxParallelFiles: 3 });

    expect(parallel).toEqual(sequential);
  });

  // ── Triple-quoted string handling regression tests ─────────────────────────────

  it('extracts renpy.call target from triple-quoted string argument', async () => {
    const script = [
      'label start:',
      '    python:',
      '        renpy.call("""call_target""")',
      '',
      'label call_target:',
      '    return',
      '',
    ].join('\n');
    const result = await parseRenpyFiles([{ name: 'triple-q-call.rpy', content: script }]);
    expect(result.edges).toContainEqual(
      expect.objectContaining({ source: 'start', target: 'call_target', kind: 'call' }),
    );
  });

  it('extracts renpy.jump target from triple-quoted string with inner parens', async () => {
    const script = [
      'label start:',
      '    python:',
      '        renpy.jump("""target_with_(parens)""")',
      '',
      'label next:',
      '    return',
      '',
    ].join('\n');
    const result = await parseRenpyFiles([{ name: 'triple-q-parens.rpy', content: script }]);
    expect(result.edges).toContainEqual(
      expect.objectContaining({ source: 'start', target: 'target_with_(parens)', kind: 'jump' }),
    );
  });

  it('splits arguments correctly when triple-quoted string contains a comma', async () => {
    const script = [
      'label start:',
      '    python:',
      '        renpy.call("""a,b""", from_current=True)',
      '',
      'label next:',
      '    return',
      '',
    ].join('\n');
    const result = await parseRenpyFiles([{ name: 'triple-q-comma.rpy', content: script }]);
    expect(result.edges).toContainEqual(
      expect.objectContaining({ source: 'start', target: 'a,b', kind: 'call' }),
    );
  });

  it('resolves keyword arg with triple-quoted value containing equals sign', async () => {
    const script = [
      'label start:',
      '    python:',
      "        renpy.jump(label='''x=y''')",
      '',
      'label next:',
      '    return',
      '',
    ].join('\n');
    const result = await parseRenpyFiles([{ name: 'triple-q-eq.rpy', content: script }]);
    expect(result.edges).toContainEqual(
      expect.objectContaining({ source: 'start', target: 'x=y', kind: 'jump' }),
    );
  });

  it('handles triple-quoted string with inner quotes and parens in renpy.call', async () => {
    const script = [
      'label start:',
      '    python:',
      '        renpy.call("""label("x")""")',
      '',
      'label next:',
      '    return',
      '',
    ].join('\n');
    const result = await parseRenpyFiles([{ name: 'triple-q-inner-quotes.rpy', content: script }]);
    const callEdge = result.edges.find(
      (e) => e.kind === 'call' && e.source === 'start',
    );
    expect(callEdge).toBeDefined();
    expect(callEdge?.target).toBe('label("x")');
  });

  // ── Whitespace-only target regression tests ────────────────────────────────────

  it('treats whitespace-only renpy.jump target as dynamic and emits a warning', async () => {
    const script = [
      'label start:',
      '    python:',
      '        renpy.jump(" ")',
      '',
      'label next:',
      '    return',
      '',
    ].join('\n');
    const result = await parseRenpyFiles([{ name: 'whitespace-target.rpy', content: script }]);
    const jumpEdge = result.edges.find(
      (e) => e.kind === 'jump' && e.source === 'start' && e.target === ' ',
    );
    expect(jumpEdge).toBeUndefined();
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'dynamic_target',
          location: expect.objectContaining({ construct: 'renpy.jump' }),
        }),
      ]),
    );
  });

  it('treats empty-string renpy.call target as dynamic and emits a warning', async () => {
    const script = [
      'label start:',
      '    python:',
      '        renpy.call("")',
      '',
      'label next:',
      '    return',
      '',
    ].join('\n');
    const result = await parseRenpyFiles([{ name: 'empty-target.rpy', content: script }]);
    const callEdge = result.edges.find(
      (e) => e.kind === 'call' && e.source === 'start' && e.target === '',
    );
    expect(callEdge).toBeUndefined();
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'dynamic_target',
          location: expect.objectContaining({ construct: 'renpy.call' }),
        }),
      ]),
    );
  });

  // ── Menu fallthrough regression tests ──────────────────────────────────────────

  it('does not add a spurious fallthrough sequence edge from a menu whose options all jump', async () => {
    const script = [
      'label choice:',
      '    menu:',
      '        "Option A":',
      '            jump end_a',
      '        "Option B":',
      '            jump end_b',
      '',
      'label end_a:',
      '    "done a"',
      '',
      'label end_b:',
      '    "done b"',
      '',
    ].join('\n');

    const result = await parseRenpyFiles([{ name: 'menu-no-fallthrough.rpy', content: script }]);

    const menuNode = result.nodes.find((n) => n.type === 'MENU');
    expect(menuNode).toBeDefined();

    // Jump edges from menu options must be present.
    const menuJumps = result.edges.filter((e) => e.source === menuNode?.id && e.kind === 'jump');
    expect(menuJumps).toHaveLength(2);

    // No spurious sequence (fallthrough) edge should be added from the menu
    // to end_a just because it is the label that follows in source order.
    const menuSequences = result.edges.filter(
      (e) => e.source === menuNode?.id && e.kind === 'sequence',
    );
    expect(menuSequences).toHaveLength(0);
  });

  // ── f-string literal normalisation regression tests ────────────────────────────

  it('strips f-string prefix and quotes from say-statement dialogue lines', async () => {
    const script = [
      'label start:',
      '    f"Hello {name}!"',
      '    F"Another line"',
      '',
    ].join('\n');

    const result = await parseRenpyFiles([{ name: 'fstring-dialogue.rpy', content: script }]);

    const node = result.nodes.find((n) => n.id === 'start');
    expect(node).toBeDefined();
    expect(node?.dialogueCount).toBe(2);
    expect(node?.dialogueLines).toEqual(['Hello {name}!', 'Another line']);
  });
});
