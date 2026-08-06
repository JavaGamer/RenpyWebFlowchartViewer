import { describe, expect, it, vi } from "vitest";

vi.mock(
  "../../src/infrastructure/parserWorkerClient",
  () => ({
    parseRenpyFilesInWorker: vi.fn((request) =>
      Promise.resolve({
        nodes: [{
          id: `node:${request.files.length}`,
          type: "LABEL",
          label: "n",
          dialogueCount: 0,
        }],
        edges: [],
      })
    ),
    searchDialogueLinesInWorker: vi.fn((request) =>
      Promise.resolve([
        {
          nodeId: "n1",
          nodeLabel: "node",
          lineIndex: 0,
          lineText: request.query,
        },
      ])
    ),
  }),
);

describe("parseService", () => {
  it("delegates parse requests to parseRenpyFilesInWorker", async () => {
    const parseInWorker = await import(
      "../../src/infrastructure/parserWorkerClient"
    );
    const { workerParseService } = await import(
      "../../src/infrastructure"
    );
    const request = {
      files: [{ name: "a.rpy", content: "label a:" }],
      appendToActiveGraph: true,
      resetActiveGraph: false,
      isFinalChunk: true,
      captureDialogueLines: true,
    };

    const result = await workerParseService.parse(request);

    expect(parseInWorker.parseRenpyFilesInWorker).toHaveBeenCalledWith(request);
    expect(result.nodes[0]?.id).toBe("node:1");
  });

  it("delegates dialogue search requests to searchDialogueLinesInWorker", async () => {
    const parseInWorker = await import(
      "../../src/infrastructure/parserWorkerClient"
    );
    const { workerParseService } = await import(
      "../../src/infrastructure"
    );
    const request = {
      query: "needle",
      nodeIds: ["start"],
      maxResults: 2,
    };

    const result = await workerParseService.searchDialogueLines(request);

    expect(parseInWorker.searchDialogueLinesInWorker).toHaveBeenCalledWith(
      request,
    );
    expect(result).toEqual([
      {
        nodeId: "n1",
        nodeLabel: "node",
        lineIndex: 0,
        lineText: "needle",
      },
    ]);
  });
});
