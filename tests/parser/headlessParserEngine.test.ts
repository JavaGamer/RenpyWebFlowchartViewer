import { describe, expect, it, vi } from "vitest";
import {
  HeadlessParserEngine,
  headlessParserEngine,
} from "../../src/parser/headlessParserEngine.ts";
import type { FlowNode, NodeDetailsPayload } from "../../src/domain/index.ts";

describe("HeadlessParserEngine", () => {
  it("manages sessions: getSession, clearSession, pruneOldSessions", () => {
    const engine = new HeadlessParserEngine();
    const s1 = engine.getSession("session_1");
    expect(s1).toBeDefined();
    expect(engine.getSession("session_1")).toBe(s1);

    const s2 = engine.getSession("session_2");
    expect(s2).not.toBe(s1);

    // Prune old sessions keeping session_2
    engine.pruneOldSessions("session_2");
    // session_1 should have been pruned so getSession will create a fresh one
    const s1Fresh = engine.getSession("session_1");
    expect(s1Fresh).not.toBe(s1);

    // Clear specific session
    engine.clearSession("session_1");

    // Clear all sessions
    engine.clearSession();
  });

  it("handles searchDialogueLines with aborted signals and cancellation callbacks", async () => {
    const engine = new HeadlessParserEngine();
    const abortCtrl = new AbortController();
    abortCtrl.abort();

    // Aborted signal
    const resAborted = await engine.searchDialogueLines({
      query: "hello",
      signal: abortCtrl.signal,
    });
    expect(resAborted).toEqual([]);

    // isCancelled callback
    const resCancelled = await engine.searchDialogueLines({
      query: "hello",
      isCancelled: () => true,
    });
    expect(resCancelled).toEqual([]);
  });

  it("handles extractNodeDetails with abort signals and fallback nodeMap extraction", async () => {
    const engine = new HeadlessParserEngine();
    const session = engine.getSession("test_session");

    // Prepopulate nodeMap with nodes
    session.accumulatedState.nodeMap.set("node_with_details", {
      id: "node_with_details",
      dialogueLines: ["Existing dialogue"],
      audioAssetCues: [{ type: "play", asset: "sound.ogg" }],
    } as FlowNode);
    session.accumulatedState.nodeMap.set("node_empty", {
      id: "node_empty",
    } as FlowNode);

    // Prepopulate nodeDetailsById
    session.nodeDetailsById = new Map<string, NodeDetailsPayload>([
      [
        "node_in_cache",
        {
          nodeId: "node_in_cache",
          dialogueLines: ["Cached dialogue"],
          dialogueLineNums: [10],
          audioAssetCues: [],
        },
      ],
    ]);
    session.accumulatedState.nodeMap.set("node_in_cache", {
      id: "node_in_cache",
    } as FlowNode);

    // Extract details
    const result = await engine.extractNodeDetails(
      ["node_in_cache", "node_with_details", "node_empty", "node_not_found"],
      "test_session",
    );

    expect(result["node_in_cache"]?.dialogueLines).toEqual(["Cached dialogue"]);
    expect(result["node_with_details"]?.dialogueLines).toEqual([
      "Existing dialogue",
    ]);
    expect(result["node_empty"]).toBeUndefined();
    expect(result["node_not_found"]).toBeUndefined();

    // Aborted signal throws AbortError synchronously
    const abortCtrl = new AbortController();
    abortCtrl.abort();
    expect(() =>
      engine.extractNodeDetails(
        ["node_in_cache"],
        "test_session",
        abortCtrl.signal,
      )
    ).toThrow();

    expect(() =>
      engine.extractNodeDetails(
        ["node_in_cache"],
        "test_session",
        undefined,
        () => true,
      )
    ).toThrow();
  });

  it("tokenizes files with and without custom fileCacheKeys", async () => {
    const engine = new HeadlessParserEngine();
    const files = [
      { name: "file1.rpy", content: "label start:\n    return\n" },
      { name: "file2.rpy", content: "label end:\n    return\n" },
    ];

    // Default keys generated
    const tokenResult1 = await engine.tokenizeFiles(files);
    expect(tokenResult1.fileCacheKeys).toHaveLength(2);
    expect(tokenResult1.fileCacheKeys[0]).toContain("file1.rpy");

    // Custom keys of matching length preserved
    const tokenResult2 = await engine.tokenizeFiles(files, {
      fileCacheKeys: ["custom_key_1", "custom_key_2"],
    });
    expect(tokenResult2.fileCacheKeys).toEqual([
      "custom_key_1",
      "custom_key_2",
    ]);

    // Custom keys of wrong length fall back to generated keys
    const tokenResult3 = await engine.tokenizeFiles(files, {
      fileCacheKeys: ["only_one_key"],
    });
    expect(tokenResult3.fileCacheKeys).toHaveLength(2);
  });

  it("parses scripts with Uint8Array content, progress callbacks, and builds dialogue search index", async () => {
    const uint8Content = new TextEncoder().encode(`
label start:
    "Hello from Uint8Array content"
    menu:
        "Choice 1":
            jump choice_target

label choice_target:
    "Target reached"
    return
`);

    const onProgress = vi.fn();
    const result = await headlessParserEngine.parse({
      files: [
        {
          name: "script.rpy",
          relativePath: "game/script.rpy",
          content: uint8Content,
        },
      ],
      sessionId: "parse_test",
      resetActiveGraph: true,
      onProgress,
    });

    expect(result.nodes.length).toBeGreaterThan(0);
    expect(result.edges.length).toBeGreaterThan(0);

    // Search lines on parsed session
    const searchRes = await headlessParserEngine.searchDialogueLines({
      sessionId: "parse_test",
      query: "Uint8Array",
    });
    expect(searchRes.length).toBe(1);
    expect(searchRes[0]?.lineText).toContain("Uint8Array");
  });
});
