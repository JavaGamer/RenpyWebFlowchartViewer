import { beforeEach, describe, expect, it } from "vitest";
import { DirectParseService } from "../../src/infrastructure/directParseService.ts";

describe("DirectParseService", () => {
  let service: DirectParseService;

  beforeEach(() => {
    service = new DirectParseService();
  });

  it("parses Ren'Py files directly with deterministic results", async () => {
    const files = [
      {
        name: "script.rpy",
        content: `
label start:
    "Hello world!"
    menu:
        "Choice 1":
            jump path_a
        "Choice 2":
            jump path_b

label path_a:
    "Path A dialogue"
    return

label path_b:
    "Path B dialogue"
    return
`,
      },
    ];

    const progressReports: Array<{ doneFiles: number; totalFiles: number }> =
      [];
    const result = await service.parse({
      files,
      resetActiveGraph: true,
      onProgress: (p) => {
        progressReports.push({
          doneFiles: p.doneFiles,
          totalFiles: p.totalFiles,
        });
      },
    });

    expect(progressReports).toHaveLength(1);
    expect(progressReports[0]).toEqual({ doneFiles: 1, totalFiles: 1 });

    expect(result.nodes.length).toBeGreaterThan(0);
    const startNode = result.nodes.find((n) => n.id === "start");
    expect(startNode).toBeDefined();

    expect(result.edges.length).toBeGreaterThan(0);
  });

  it("builds dialogue search index and executes queries", async () => {
    const files = [
      {
        name: "story.rpy",
        content: `
label start:
    "The secret diamond is hidden in the castle."
    jump chapter_two

label chapter_two:
    "The dragon sleeps atop the mountain."
    return
`,
      },
    ];

    await service.parse({
      files,
      resetActiveGraph: true,
      captureDialogueLines: true,
    });

    const diamondResults = await service.searchDialogueLines({
      query: "diamond",
    });
    expect(diamondResults.length).toBe(1);
    expect(diamondResults[0]!.nodeId).toBe("start");
    expect(diamondResults[0]!.lineText).toContain("secret diamond");

    const dragonResults = await service.searchDialogueLines({
      query: "dragon",
    });
    expect(dragonResults.length).toBe(1);
    expect(dragonResults[0]!.nodeId).toBe("chapter_two");

    const filtered = await service.searchDialogueLines({
      query: "diamond",
      nodeIds: ["chapter_two"],
    });
    expect(filtered).toHaveLength(0);
  });

  it("lazily extracts unhydrated node details", async () => {
    const files = [
      {
        name: "chapter1.rpy",
        content: `
label scene_one:
    "Dialogue line 1"
    "Dialogue line 2"
    return
`,
      },
    ];

    const parseResult = await service.parse({
      files,
      resetActiveGraph: true,
      deferDetails: true,
    });

    const sceneNode = parseResult.nodes.find((n) => n.id === "scene_one");
    expect(sceneNode).toBeDefined();

    const details = await service.extractNodeDetails(["scene_one"]);
    expect(details["scene_one"]).toBeDefined();
    expect(details["scene_one"]!.dialogueLines).toEqual([
      "Dialogue line 1",
      "Dialogue line 2",
    ]);
  });

  it("supports abort signal cancellation during parse", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      service.parse({
        files: [{ name: "a.rpy", content: "label a: return" }],
        signal: controller.signal,
      }),
    ).rejects.toThrow("Parsing cancelled");
  });

  it("manages isolated sessions independently", async () => {
    await service.parse({
      files: [{ name: "sess1.rpy", content: "label sess1: return" }],
      sessionId: "session_1",
    });

    await service.parse({
      files: [{ name: "sess2.rpy", content: "label sess2: return" }],
      sessionId: "session_2",
    });

    const s1 = service.getSession("session_1");
    const s2 = service.getSession("session_2");

    expect(s1.accumulatedState.nodeMap.has("sess1")).toBe(true);
    expect(s1.accumulatedState.nodeMap.has("sess2")).toBe(false);

    expect(s2.accumulatedState.nodeMap.has("sess2")).toBe(true);
    expect(s2.accumulatedState.nodeMap.has("sess1")).toBe(false);

    service.clearSession("session_1");
    expect(service.getSession("session_1").accumulatedState.nodes).toHaveLength(
      0,
    );
    expect(
      service.getSession("session_2").accumulatedState.nodeMap.has("sess2"),
    ).toBe(true);
  });

  it("supports engine: 'modern' for AST story graph parsing and search", async () => {
    const files = [
      {
        name: "chapter1.rpy",
        content: `
label start:
    "Welcome to the adventure."
    menu:
        "Go East":
            jump east_cave
        "Go West":
            jump west_cave

label east_cave:
    "The east cave contains glowing crystals."
    return

label west_cave:
    "The west cave has a sleeping beast."
    return
`,
      },
    ];

    const result = await service.parse({
      engine: "modern",
      files,
      resetActiveGraph: true,
    });

    // 3 LabelNodes + 1 MenuNode
    expect(result.nodes.map((n) => n.id)).toEqual([
      "start",
      "menu_start_L3",
      "east_cave",
      "west_cave",
    ]);

    const crystalResults = await service.searchDialogueLines({
      query: "crystals",
    });
    expect(crystalResults.length).toBe(1);
    expect(crystalResults[0]!.nodeId).toBe("east_cave");
  });
});
