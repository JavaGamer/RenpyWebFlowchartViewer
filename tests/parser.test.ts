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

});
