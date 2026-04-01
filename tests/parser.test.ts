import { describe, expect, it } from 'vitest';
import { parseRenpyFiles } from '../src/parser';

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
});
