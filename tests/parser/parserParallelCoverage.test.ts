import { beforeEach, describe, expect, it, vi } from "vitest";

type FilePipelineMocks = {
  parseOneFile: ReturnType<typeof vi.fn>;
  processTokenizedFile: ReturnType<typeof vi.fn>;
  tokenizeOneFile: ReturnType<typeof vi.fn>;
};

async function loadParserWithMocks(filePipelineMocks: FilePipelineMocks) {
  vi.doMock("../../src/infrastructure", () => ({
    createPerfTracker: () => ({
      mark: vi.fn(),
      measure: vi.fn(),
    }),
  }));

  vi.doMock("../../src/parser/pipelineState", () => ({
    createGraphState: () => ({
      nodes: [],
      edges: [],
      diagnostics: [],
      canonicalLabelIdByName: new Map(),
      labelDefinitionCountByName: new Map(),
      labelsByChapter: new Map(),
      globalScreens: new Set(),
      globalCharacters: new Set(),
    }),
  }));

  vi.doMock("../../src/parser/filePipeline", () => filePipelineMocks);
  vi.doMock(
    "../../src/parser/roleFinalization",
    () => ({ finalizeRoles: vi.fn() }),
  );
  vi.doMock("../../src/parser/mapReduceLinker", () => ({
    parseFileToFragment: async (
      file: { name: string },
      options: Record<string, unknown>,
      state: Record<string, unknown>,
      idx: number,
    ) => {
      const tokenized = await filePipelineMocks.tokenizeOneFile(
        file,
        options,
        idx,
      );
      if (!tokenized) {
        throw new Error(
          `Failed to tokenize file at index ${idx} (${
            file?.name ?? "unknown"
          })`,
        );
      }
      filePipelineMocks.processTokenizedFile(state, tokenized, options);
      return {
        filePath: file.name,
        chapter: file.name.replace(/\.rpy$/, ""),
        fileIndex: idx,
        nodes: [],
        edges: [],
        diagnostics: [],
        pendingCallReturns: [],
        hasReturnInLabel: [],
        hasReliableReturnInLabel: [],
        calledLabels: [],
        calledFromMenuOptionTargets: [],
        nodeMutations: [],
        labelDefinitionCount: [],
        canonicalLabelIds: [],
        globalScreens: [],
        globalCharacters: [],
      };
    },
    linkGraphFragments: (
      _fragments: unknown[],
      state: Record<string, unknown>,
    ) => {
      return state ?? { nodes: [], edges: [] };
    },
  }));

  return await import("../../src/parser/parser");
}

describe("parseRenpyFiles coverage gaps", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("falls back to single concurrency when maxParallelFiles is non-finite", async () => {
    const parseOneFile = vi.fn(() => Promise.resolve(undefined));
    const processTokenizedFile = vi.fn();
    const tokenizeOneFile = vi.fn(() =>
      Promise.resolve({
        file: { name: "a.rpy" },
        chapter: "a",
        document: { getText: () => "label a:\n return\n" },
        tokenTree: { root: { children: [] } },
      })
    );

    const { parseRenpyFiles } = await loadParserWithMocks({
      parseOneFile,
      processTokenizedFile,
      tokenizeOneFile,
    });

    await expect(
      parseRenpyFiles([{ name: "a.rpy", content: "label a:\n    return\n" }], {
        maxParallelFiles: NaN,
      }),
    ).resolves.toEqual({ nodes: [], edges: [] });

    expect(tokenizeOneFile).toHaveBeenCalledTimes(1);
    expect(processTokenizedFile).toHaveBeenCalledTimes(1);
  });

  it("throws when tokenization fails for a file in Map pass", async () => {
    const parseOneFile = vi.fn(() => Promise.resolve(undefined));
    const processTokenizedFile = vi.fn();
    const tokenizeOneFile = vi
      .fn()
      .mockResolvedValueOnce({
        file: { name: "a.rpy" },
        chapter: "a",
        document: { getText: () => "label a:\n return\n" },
        tokenTree: { root: { children: [] } },
      })
      .mockRejectedValueOnce(
        new Error("Failed to tokenize file at index 1 (b.rpy)"),
      );

    const { parseRenpyFiles } = await loadParserWithMocks({
      parseOneFile,
      processTokenizedFile,
      tokenizeOneFile,
    });

    await expect(
      parseRenpyFiles(
        [
          { name: "a.rpy", content: "label a:\n    return\n" },
          { name: "b.rpy", content: "label b:\n    return\n" },
        ],
        { maxParallelFiles: 2 },
      ),
    ).rejects.toThrow("Failed to tokenize file at index 1 (b.rpy)");
  });

  it("uses single concurrency when maxParallelFiles is exactly 1", async () => {
    const parseOneFile = vi.fn(() => Promise.resolve(undefined));
    const processTokenizedFile = vi.fn();
    const tokenizeOneFile = vi.fn(() =>
      Promise.resolve({
        file: { name: "a.rpy" },
        chapter: "a",
        document: { getText: () => "label a:\n return\n" },
        tokenTree: { root: { children: [] } },
      })
    );

    const { parseRenpyFiles } = await loadParserWithMocks({
      parseOneFile,
      processTokenizedFile,
      tokenizeOneFile,
    });

    await expect(
      parseRenpyFiles([{ name: "a.rpy", content: "label a:\n    return\n" }], {
        maxParallelFiles: 1,
      }),
    ).resolves.toEqual({ nodes: [], edges: [] });

    expect(tokenizeOneFile).toHaveBeenCalledTimes(1);
    expect(processTokenizedFile).toHaveBeenCalledTimes(1);
  });

  it("uses single concurrency when maxParallelFiles is 0 (treated as <= 1)", async () => {
    const parseOneFile = vi.fn(() => Promise.resolve(undefined));
    const processTokenizedFile = vi.fn();
    const tokenizeOneFile = vi.fn(() =>
      Promise.resolve({
        file: { name: "a.rpy" },
        chapter: "a",
        document: { getText: () => "label a:\n return\n" },
        tokenTree: { root: { children: [] } },
      })
    );

    const { parseRenpyFiles } = await loadParserWithMocks({
      parseOneFile,
      processTokenizedFile,
      tokenizeOneFile,
    });

    await expect(
      parseRenpyFiles([{ name: "a.rpy", content: "label a:\n" }], {
        maxParallelFiles: 0,
      }),
    ).resolves.toEqual({ nodes: [], edges: [] });

    expect(tokenizeOneFile).toHaveBeenCalledTimes(1);
    expect(processTokenizedFile).toHaveBeenCalledTimes(1);
  });

  it("returns empty result when files array is empty, even with high maxParallelFiles", async () => {
    const parseOneFile = vi.fn(() => Promise.resolve(undefined));
    const processTokenizedFile = vi.fn();
    const tokenizeOneFile = vi.fn(() =>
      Promise.resolve({
        file: { name: "a.rpy" },
        chapter: "a",
        document: { getText: () => "label a:\n return\n" },
        tokenTree: { root: { children: [] } },
      })
    );

    const { parseRenpyFiles } = await loadParserWithMocks({
      parseOneFile,
      processTokenizedFile,
      tokenizeOneFile,
    });

    await expect(
      parseRenpyFiles([], { maxParallelFiles: 8 }),
    ).resolves.toEqual({ nodes: [], edges: [] });

    expect(tokenizeOneFile).not.toHaveBeenCalled();
    expect(processTokenizedFile).not.toHaveBeenCalled();
  });

  it("falls back to file name comparison when normalized relative paths are identical", async () => {
    const parseOneFile = vi.fn(() => Promise.resolve(undefined));
    const processTokenizedFile = vi.fn();
    const tokenizeOneFile = vi.fn((file: { name: string }) =>
      Promise.resolve({
        file,
        chapter: file.name,
        document: { getText: () => "label a:\n" },
        tokenTree: { root: { children: [] } },
      })
    );

    const { parseRenpyFiles } = await loadParserWithMocks({
      parseOneFile,
      processTokenizedFile,
      tokenizeOneFile,
    });

    await expect(
      parseRenpyFiles(
        [
          {
            name: "b.rpy",
            relativePath: "routes\\same.rpy",
            content: "label b:\n",
          },
          {
            name: "a.rpy",
            relativePath: "routes/same.rpy",
            content: "label a:\n",
          },
        ],
        { maxParallelFiles: 1 },
      ),
    ).resolves.toEqual({ nodes: [], edges: [] });

    expect(tokenizeOneFile).toHaveBeenCalledTimes(2);
    expect(
      tokenizeOneFile.mock.calls.map(([file]) =>
        (file as { name: string }).name
      ),
    ).toEqual([
      "a.rpy",
      "b.rpy",
    ]);
  });

  it("reports currentFile as the file name in sequential progress when relativePath is absent", async () => {
    const parseOneFile = vi.fn(() => Promise.resolve(undefined));
    const processTokenizedFile = vi.fn();
    const tokenizeOneFile = vi.fn(() =>
      Promise.resolve({
        file: { name: "a.rpy" },
        chapter: "a",
        document: { getText: () => "label a:\n" },
        tokenTree: { root: { children: [] } },
      })
    );
    const progressFiles: string[] = [];

    const { parseRenpyFiles } = await loadParserWithMocks({
      parseOneFile,
      processTokenizedFile,
      tokenizeOneFile,
    });

    await expect(
      parseRenpyFiles([{ name: "a.rpy", content: "label a:\n" }], {
        maxParallelFiles: 1,
        onProgress: (progress) => {
          progressFiles.push(progress.currentFile);
        },
      }),
    ).resolves.toEqual({ nodes: [], edges: [] });

    expect(progressFiles).toEqual(["a.rpy"]);
  });

  it("reports currentFile as the file name in parallel progress when relativePath is absent", async () => {
    const parseOneFile = vi.fn(() => Promise.resolve(undefined));
    const processTokenizedFile = vi.fn();
    const tokenizeOneFile = vi.fn((file: { name: string }) =>
      Promise.resolve({
        file,
        chapter: file.name,
        document: { getText: () => "label a:\n" },
        tokenTree: { root: { children: [] } },
      })
    );
    const progressFiles: string[] = [];

    const { parseRenpyFiles } = await loadParserWithMocks({
      parseOneFile,
      processTokenizedFile,
      tokenizeOneFile,
    });

    await expect(
      parseRenpyFiles(
        [
          { name: "b.rpy", content: "label b:\n" },
          { name: "a.rpy", content: "label a:\n" },
        ],
        {
          maxParallelFiles: 2,
          onProgress: (progress) => {
            progressFiles.push(progress.currentFile);
          },
        },
      ),
    ).resolves.toEqual({ nodes: [], edges: [] });

    expect(progressFiles).toEqual(["a.rpy", "b.rpy"]);
    expect(tokenizeOneFile).toHaveBeenCalledTimes(2);
    expect(processTokenizedFile).toHaveBeenCalledTimes(2);
  });
});
