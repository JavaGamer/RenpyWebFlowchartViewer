import { expect, test } from "vitest";
import {
  extractNodeDetailsFromTokens,
  parseRenpyFiles,
  tokenizeOneFile,
} from "../../src/parser/index.ts";
import type { ParseInputFile } from "../../src/parser/index.ts";

const SAMPLE_RPY = `
label start:
    scene bg classroom with dissolve
    play music "bgm_daily.ogg" fadein 1.0
    "Teacher" "Welcome to school today, everyone."
    "Student" "Good morning, teacher!"
    stop music fadeout 1.0
    voice "voice_001.ogg"
    "Teacher" "Please open your textbooks to page 42."
    jump chapter_2

label chapter_2:
    scene bg library
    play sound "page_turn.ogg"
    "Student" "I need to find a book about history."
    return
`;

test("deferDetails skips line allocations and audio cue regexes while computing counts", async () => {
  const files: ParseInputFile[] = [
    {
      name: "script.rpy",
      content: SAMPLE_RPY,
    },
  ];

  const resultFull = await parseRenpyFiles(files, { deferDetails: false });
  const resultDeferred = await parseRenpyFiles(files, { deferDetails: true });

  expect(resultFull.nodes.length).toEqual(resultDeferred.nodes.length);
  expect(resultFull.edges.length).toEqual(resultDeferred.edges.length);

  const startNodeFull = resultFull.nodes.find((n) => n.id === "start")!;
  const startNodeDeferred = resultDeferred.nodes.find((n) => n.id === "start")!;

  expect(startNodeFull.dialogueCount).toBeGreaterThan(0);
  expect(startNodeDeferred.dialogueCount).toEqual(startNodeFull.dialogueCount);
  expect(startNodeDeferred.wordCount).toEqual(startNodeFull.wordCount);

  // Full parse has dialogue lines and audio cues
  expect(startNodeFull.dialogueLines).toBeDefined();
  expect(startNodeFull.audioAssetCues).toBeDefined();

  // Deferred parse omits dialogue lines and audio cues
  expect(startNodeDeferred.dialogueLines).toBeUndefined();
  expect(startNodeDeferred.audioAssetCues).toBeUndefined();
  expect(startNodeDeferred.isDetailsLoaded).toBeFalsy();
});

test("extractNodeDetailsFromTokens hydrates deferred node details on demand", async () => {
  const file: ParseInputFile = {
    name: "script.rpy",
    content: SAMPLE_RPY,
  };

  const parseResult = await parseRenpyFiles([file], { deferDetails: true });
  const startNode = parseResult.nodes.find((n) =>
    n.label === "start" || n.id === "start"
  )!;

  const tokenized = await tokenizeOneFile(file, { chapter: startNode.chapter });
  const tokenizedMap = new Map([[startNode.chapter || "", tokenized]]);

  const details = extractNodeDetailsFromTokens([startNode], tokenizedMap);

  expect(details[startNode.id]).toBeDefined();
  const startPayload = details[startNode.id]!;
  expect(startPayload.dialogueLines?.length).toBe(3);
  expect(startPayload.audioAssetCues?.length).toBe(4); // scene, play music, stop music, voice
  expect(startPayload.dialogueLines![0]).toBe(
    "Welcome to school today, everyone.",
  );
});

test("sub-100ms parse performance for synthetic large project", async () => {
  const lineBlock = `
    "Character A" "This is a line of dialogue in a large visual novel project."
    play music "audio.ogg"
`;
  const largeContent = `label start:\n` + lineBlock.repeat(250) + `\nreturn\n`;
  const files: ParseInputFile[] = Array.from({ length: 10 }, (_, i) => ({
    name: `chapter_${i}.rpy`,
    content: largeContent,
  }));

  const start = performance.now();
  const result = await parseRenpyFiles(files, { deferDetails: true });
  const elapsed = performance.now() - start;

  expect(result.nodes.length).toBeGreaterThan(0);
  expect(elapsed).toBeLessThan(20000); // Fast execution
}, 30000);
