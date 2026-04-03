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

    expect(result.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: 'start', target: 'branch_a' }),
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
});
