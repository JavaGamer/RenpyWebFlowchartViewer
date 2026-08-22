import { describe, expect, it } from "vitest";
import {
  computeChapterAggregates,
  extractChapterName,
  getChapterId,
  groupNodesByChapter,
  isChapterId,
  redirectEdgesForCollapsedChapters,
} from "../../src/domain/index.ts";
import type { FlowEdge, FlowNode } from "../../src/domain/index.ts";

describe("chapterGrouping domain transforms", () => {
  const sampleNodes: FlowNode[] = [
    {
      id: "ch1_start",
      type: "LABEL",
      label: "ch1_start",
      dialogueCount: 5,
      wordCount: 50,
      pauseDuration: 2.0,
      chapter: "chapter1.rpy",
    },
    {
      id: "ch1_menu",
      type: "MENU",
      label: "ch1_choice",
      dialogueCount: 1,
      wordCount: 10,
      chapter: "chapter1.rpy",
    },
    {
      id: "ch2_start",
      type: "LABEL",
      label: "ch2_start",
      dialogueCount: 8,
      wordCount: 100,
      chapter: "chapter2.rpy",
    },
    {
      id: "orphan_label",
      type: "LABEL",
      label: "orphan_label",
      dialogueCount: 2,
      wordCount: 20,
    },
  ];

  it("extracts and formats chapter IDs correctly", () => {
    expect(getChapterId("chapter1.rpy")).toBe("chapter:chapter1.rpy");
    expect(isChapterId("chapter:chapter1.rpy")).toBe(true);
    expect(isChapterId("ch1_start")).toBe(false);
    expect(extractChapterName("chapter:chapter1.rpy")).toBe("chapter1.rpy");
    expect(extractChapterName("regular_node")).toBe("regular_node");
  });

  it("groups nodes by chapter name and maps chapterless nodes to Uncategorized", () => {
    const groups = groupNodesByChapter(sampleNodes);
    expect(groups.has("chapter1.rpy")).toBe(true);
    expect(groups.has("chapter2.rpy")).toBe(true);
    expect(groups.has("Uncategorized")).toBe(true);
    expect(groups.get("chapter1.rpy")).toHaveLength(2);
    expect(groups.get("chapter2.rpy")).toHaveLength(1);
    expect(groups.get("Uncategorized")).toHaveLength(1);
  });

  it("computes accurate chapter aggregate metrics", () => {
    const aggregates = computeChapterAggregates(sampleNodes);
    const ch1 = aggregates.get("chapter1.rpy");
    expect(ch1).toBeDefined();
    expect(ch1?.nodeCount).toBe(2);
    expect(ch1?.dialogueCount).toBe(6);
    expect(ch1?.wordCount).toBe(60);
    expect(ch1?.pauseDuration).toBe(2.0);
    expect(ch1?.labelCount).toBe(1);
    expect(ch1?.menuCount).toBe(1);
  });

  it("redirects edges and suppresses internal edges for collapsed chapters", () => {
    const sampleEdges: FlowEdge[] = [
      {
        id: "e1",
        source: "ch1_start",
        target: "ch1_menu",
        kind: "sequence",
      },
      {
        id: "e2",
        source: "ch1_menu",
        target: "ch2_start",
        kind: "jump",
      },
      {
        id: "e3",
        source: "orphan_label",
        target: "ch1_start",
        kind: "call",
      },
    ];

    // When chapter1.rpy is collapsed
    const redirected = redirectEdgesForCollapsedChapters(
      sampleEdges,
      sampleNodes,
      { "chapter1.rpy": true },
    );

    // e1 (internal to chapter1) should be suppressed
    expect(
      redirected.some((e) =>
        e.source === "ch1_start" && e.target === "ch1_menu"
      ),
    ).toBe(false);

    // e2 (ch1_menu -> ch2_start) should become chapter:chapter1.rpy -> ch2_start
    const redirectedE2 = redirected.find((e) => e.target === "ch2_start");
    expect(redirectedE2).toBeDefined();
    expect(redirectedE2?.source).toBe("chapter:chapter1.rpy");

    // e3 (orphan_label -> ch1_start) should become orphan_label -> chapter:chapter1.rpy
    const redirectedE3 = redirected.find((e) => e.source === "orphan_label");
    expect(redirectedE3).toBeDefined();
    expect(redirectedE3?.target).toBe("chapter:chapter1.rpy");
  });
});
