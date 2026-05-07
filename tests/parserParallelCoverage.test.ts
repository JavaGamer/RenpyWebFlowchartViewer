import { beforeEach, describe, expect, it, vi } from 'vitest';

type FilePipelineMocks = {
  parseOneFile: ReturnType<typeof vi.fn>;
  processTokenizedFile: ReturnType<typeof vi.fn>;
  tokenizeOneFile: ReturnType<typeof vi.fn>;
};

async function loadParserWithMocks(filePipelineMocks: FilePipelineMocks) {
  vi.doMock('../src/perf', () => ({
    createPerfTracker: () => ({
      mark: vi.fn(),
      measure: vi.fn(),
    }),
  }));

  vi.doMock('../src/parser/pipelineState', () => ({
    createGraphState: () => ({
      nodes: [],
      edges: [],
      diagnostics: [],
    }),
  }));

  vi.doMock('../src/parser/filePipeline', () => filePipelineMocks);
  vi.doMock('../src/parser/roleFinalization', () => ({ finalizeRoles: vi.fn() }));

  return import('../src/parser');
}

describe('parseRenpyFiles coverage gaps', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('falls back to sequential parsing when maxParallelFiles is non-finite', async () => {
    const parseOneFile = vi.fn(async () => undefined);
    const processTokenizedFile = vi.fn();
    const tokenizeOneFile = vi.fn(async () => ({ file: { name: 'a.rpy' }, tokenState: {} }));

    const { parseRenpyFiles } = await loadParserWithMocks({
      parseOneFile,
      processTokenizedFile,
      tokenizeOneFile,
    });

    await expect(
      parseRenpyFiles([{ name: 'a.rpy', content: 'label a:\n    return\n' }], {
        maxParallelFiles: NaN,
      }),
    ).resolves.toEqual({ nodes: [], edges: [] });

    expect(parseOneFile).toHaveBeenCalledTimes(1);
    expect(tokenizeOneFile).not.toHaveBeenCalled();
    expect(processTokenizedFile).not.toHaveBeenCalled();
  });

  it('throws when a tokenized file is missing after parallel tokenization', async () => {
    const parseOneFile = vi.fn(async () => undefined);
    const processTokenizedFile = vi.fn();
    const tokenizeOneFile = vi
      .fn()
      .mockResolvedValueOnce({ file: { name: 'a.rpy' }, tokenState: {} })
      .mockResolvedValueOnce(undefined);

    const { parseRenpyFiles } = await loadParserWithMocks({
      parseOneFile,
      processTokenizedFile,
      tokenizeOneFile,
    });

    await expect(
      parseRenpyFiles(
        [
          { name: 'a.rpy', content: 'label a:\n    return\n' },
          { name: 'b.rpy', content: 'label b:\n    return\n' },
        ],
        { maxParallelFiles: 2 },
      ),
    ).rejects.toThrow('Failed to tokenize file at index 1 (b.rpy)');

    expect(parseOneFile).not.toHaveBeenCalled();
    expect(tokenizeOneFile).toHaveBeenCalledTimes(2);
    expect(processTokenizedFile).toHaveBeenCalledTimes(1);
  });

  it('uses sequential path when maxParallelFiles is exactly 1', async () => {
    const parseOneFile = vi.fn(async () => undefined);
    const processTokenizedFile = vi.fn();
    const tokenizeOneFile = vi.fn(async () => ({ file: { name: 'a.rpy' }, tokenState: {} }));

    const { parseRenpyFiles } = await loadParserWithMocks({
      parseOneFile,
      processTokenizedFile,
      tokenizeOneFile,
    });

    await expect(
      parseRenpyFiles([{ name: 'a.rpy', content: 'label a:\n    return\n' }], {
        maxParallelFiles: 1,
      }),
    ).resolves.toEqual({ nodes: [], edges: [] });

    expect(parseOneFile).toHaveBeenCalledTimes(1);
    expect(tokenizeOneFile).not.toHaveBeenCalled();
  });

  it('uses sequential path when maxParallelFiles is 0 (treated as <= 1)', async () => {
    const parseOneFile = vi.fn(async () => undefined);
    const processTokenizedFile = vi.fn();
    const tokenizeOneFile = vi.fn(async () => ({ file: { name: 'a.rpy' }, tokenState: {} }));

    const { parseRenpyFiles } = await loadParserWithMocks({
      parseOneFile,
      processTokenizedFile,
      tokenizeOneFile,
    });

    await expect(
      parseRenpyFiles([{ name: 'a.rpy', content: 'label a:\n' }], {
        maxParallelFiles: 0,
      }),
    ).resolves.toEqual({ nodes: [], edges: [] });

    expect(parseOneFile).toHaveBeenCalledTimes(1);
    expect(tokenizeOneFile).not.toHaveBeenCalled();
  });

  it('returns empty result when files array is empty, even with high maxParallelFiles', async () => {
    // Regression: getMaxParallelFiles() used to return 0 for empty input,
    // causing pLimit(0) to throw. It must now clamp to at least 1.
    const parseOneFile = vi.fn(async () => undefined);
    const processTokenizedFile = vi.fn();
    const tokenizeOneFile = vi.fn(async () => ({ file: { name: 'a.rpy' }, tokenState: {} }));

    const { parseRenpyFiles } = await loadParserWithMocks({
      parseOneFile,
      processTokenizedFile,
      tokenizeOneFile,
    });

    await expect(
      parseRenpyFiles([], { maxParallelFiles: 8 }),
    ).resolves.toEqual({ nodes: [], edges: [] });

    expect(parseOneFile).not.toHaveBeenCalled();
    expect(tokenizeOneFile).not.toHaveBeenCalled();
  });
});
