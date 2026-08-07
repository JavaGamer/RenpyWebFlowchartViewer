import { afterEach, expect, test } from "vitest";
import {
  extractNodeDetailsInWorker,
  parseRenpyFilesInWorker,
  setWorkerSpawningFailedForTesting,
  tokenizeFilesInWorker,
} from "../../src/infrastructure/parserWorkerClient.ts";
import { parserApi } from "../../src/infrastructure/parserWorker.ts";
import type { ParseInputFile } from "../../src/parser/index.ts";

const SAMPLE_RPY = `
label start:
    scene bg room
    play music "bgm.ogg"
    "Hero" "Hello world!"
    return
`;

afterEach(() => {
  setWorkerSpawningFailedForTesting(false);
});

test("tokenizeFilesInWorker handles fallback when workers are disabled", async () => {
  setWorkerSpawningFailedForTesting(true);

  const files: ParseInputFile[] = [
    {
      name: "script.rpy",
      content: SAMPLE_RPY,
    },
  ];

  const result = await tokenizeFilesInWorker(files);
  expect(result.fileCacheKeys.length).toBe(1);
  expect(typeof result.fileCacheKeys[0]).toBe("string");
});

test("parseRenpyFilesInWorker fallback handles deferDetails and extractNodeDetails", async () => {
  setWorkerSpawningFailedForTesting(true);

  const files: ParseInputFile[] = [
    {
      name: "script.rpy",
      content: SAMPLE_RPY,
    },
  ];

  const parseResult = await parseRenpyFilesInWorker({
    files,
    deferDetails: true,
  });

  expect(parseResult.nodes.length).toBeGreaterThan(0);
  const startNode = parseResult.nodes.find((n) =>
    n.label === "start" || n.id === "start"
  )!;
  expect(startNode.dialogueCount).toBe(1);

  const details = await extractNodeDetailsInWorker([startNode.id]);
  expect(details[startNode.id]).toBeDefined();
});

test("parserWorker API handles tokenize and extractDetails protocol requests directly", async () => {
  const files: ParseInputFile[] = [
    {
      name: "script.rpy",
      content: SAMPLE_RPY,
    },
  ];

  const tokenizeRes = await parserApi.tokenize(1, files, {
    fileCacheKeys: ["key_1"],
  });
  expect(tokenizeRes.fileCacheKeys.length).toBe(1);

  const parseRes = await parserApi.parse(2, files, {
    sessionId: "test_session",
    fileCacheKeys: ["key_1"],
    wantsProgress: false,
    deferDetails: true,
  });

  expect(parseRes.nodes.length).toBeGreaterThan(0);
  const startNode = parseRes.nodes.find((n) =>
    n.label === "start" || n.id === "start"
  )!;

  const detailsRes = await parserApi.extractDetails(3, [startNode.id], {
    sessionId: "test_session",
  });
  expect(detailsRes[startNode.id]).toBeDefined();
  expect(detailsRes[startNode.id]!.dialogueLines?.length).toBe(1);
  expect(detailsRes[startNode.id]!.dialogueLines![0]).toBe("Hello world!");
});
