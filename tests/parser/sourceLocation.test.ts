import { describe, expect, it } from "vitest";
import { parseRenpyFiles } from "../../src/parser/parser.ts";
import type { ParseInputFile } from "../../src/parser/pipelineTypes.ts";
import { simplifyGraph } from "../../src/domain/transforms/simplify.ts";

describe("Source Location Offset & Character Range Mapping", () => {
  it("populates sourceLocation on FlowNode, FlowEdge, and AudioAssetCue", async () => {
    const script = `label start:
    "Welcome to the story"
    play music "bgm.ogg"
    jump chapter_1

label chapter_1:
    e "Chapter 1 text"
    voice "v01.ogg"
    return
`;

    const files: ParseInputFile[] = [{
      name: "script.rpy",
      content: script,
    }];

    const result = await parseRenpyFiles(files);
    expect(result.nodes).toHaveLength(2);

    const startNode = result.nodes.find((n) => n.label === "start")!;
    expect(startNode).toBeDefined();
    expect(startNode.sourceLocation).toBeDefined();
    expect(startNode.sourceLocation?.file).toBe("script");
    expect(startNode.sourceLocation?.start.line).toBe(0);
    expect(startNode.sourceLocation?.start.character).toBe(0);
    expect(startNode.sourceLocation?.end.line).toBeGreaterThanOrEqual(3);

    const chapterNode = result.nodes.find((n) => n.label === "chapter_1")!;
    expect(chapterNode).toBeDefined();
    expect(chapterNode.sourceLocation).toBeDefined();
    expect(chapterNode.sourceLocation?.file).toBe("script");
    expect(chapterNode.sourceLocation?.start.line).toBe(5);

    // Audio cue source location assertions
    expect(startNode.audioAssetCues).toHaveLength(1);
    expect(startNode.audioAssetCues![0]?.sourceLocation).toBeDefined();
    expect(startNode.audioAssetCues![0]?.sourceLocation?.file).toBe(
      "script",
    );

    expect(chapterNode.audioAssetCues).toHaveLength(1);
    expect(chapterNode.audioAssetCues![0]?.sourceLocation).toBeDefined();
    expect(chapterNode.audioAssetCues![0]?.sourceLocation?.file).toBe(
      "script",
    );

    // Edge source location assertions
    const jumpEdge = result.edges.find((e) => e.kind === "jump")!;
    expect(jumpEdge).toBeDefined();
    expect(jumpEdge.sourceLocation).toBeDefined();
    expect(jumpEdge.sourceLocation?.file).toBe("script");
    expect(jumpEdge.sourceLocation?.start.line).toBe(3);
  });

  it("accumulates collapsedLocations when linear label chains are collapsed", () => {
    const nodes = [
      {
        id: "label_1",
        type: "LABEL" as const,
        label: "Label 1",
        dialogueCount: 2,
        chapter: "ch1",
        sourceLocation: {
          file: "ch1.rpy",
          start: { line: 0, character: 0, offset: 0 },
          end: { line: 5, character: 10, offset: 120 },
        },
      },
      {
        id: "label_2",
        type: "LABEL" as const,
        label: "Label 2",
        dialogueCount: 3,
        chapter: "ch1",
        sourceLocation: {
          file: "ch1.rpy",
          start: { line: 6, character: 0, offset: 121 },
          end: { line: 12, character: 10, offset: 250 },
        },
      },
    ];

    const edges = [
      {
        id: "seq_label_1__label_2",
        source: "label_1",
        target: "label_2",
        kind: "sequence" as const,
      },
    ];

    const simplified = simplifyGraph(nodes, edges, {
      collapseLinearChains: true,
      inlineUtilities: false,
      inlineDetours: false,
      inlineStateToggles: false,
      inlineEmptyLabels: false,
      inlineDialogueThreshold: 0,
    });

    expect(simplified.nodes).toHaveLength(1);
    const mergedNode = simplified.nodes[0]!;
    expect(mergedNode.id).toBe("label_1");
    expect(mergedNode.collapsedLocations).toHaveLength(2);
    expect(mergedNode.collapsedLocations![0]?.start.line).toBe(0);
    expect(mergedNode.collapsedLocations![1]?.start.line).toBe(6);
    expect(mergedNode.sourceLocation?.start.line).toBe(0);
    expect(mergedNode.sourceLocation?.end.line).toBe(12);
  });

  it("populates sourceLocation on DECISION nodes, MENU nodes, and diagnostics", async () => {
    const fileA = `label start:
    if is_active:
        jump start
    else:
        menu:
            "Choice A":
                jump start
`;
    const fileB = `label start:
    return
`;

    const files: ParseInputFile[] = [
      { name: "file_a.rpy", content: fileA },
      { name: "file_b.rpy", content: fileB },
    ];

    const result = await parseRenpyFiles(files);
    const decisionNode = result.nodes.find((n) => n.type === "DECISION");
    expect(decisionNode).toBeDefined();
    expect(decisionNode?.sourceLocation).toBeDefined();
    expect(decisionNode?.sourceLocation?.file).toBe("file_a");

    const menuNode = result.nodes.find((n) => n.type === "MENU");
    expect(menuNode).toBeDefined();
    expect(menuNode?.sourceLocation).toBeDefined();
    expect(menuNode?.sourceLocation?.file).toBe("file_a");

    const shadowedDiag = result.diagnostics.find((d) =>
      d.code === "shadowed_label"
    );
    expect(shadowedDiag).toBeDefined();
    expect(shadowedDiag?.location?.sourceLocation).toBeDefined();
    expect(shadowedDiag?.location?.sourceLocation?.file).toBe("file_b");
  });
});
