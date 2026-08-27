import { describe, expect, it } from "vitest";
import type { FlowEdge, FlowNode } from "../../src/domain/index.ts";
import {
  applyDagreLayout,
  applyTwoTierDagreLayout,
} from "../../src/infrastructure/layoutEngines.ts";
import {
  CHAPTER_CONTAINER_PADDING,
  CHAPTER_SUMMARY_HEIGHT,
  CHAPTER_SUMMARY_WIDTH,
  NODE_WIDTH,
} from "../../src/domain/index.ts";

describe("Two-Tier Hierarchical Dagre Layout Engine", () => {
  it("places multi-chapter nodes inside tight container bounds with exact padding", () => {
    const rawNodes: FlowNode[] = [
      {
        id: "ch1_start",
        label: "Chapter 1 Start",
        type: "LABEL",
        dialogueCount: 5,
        chapter: "Chapter 1",
      },
      {
        id: "ch1_choice",
        label: "Chapter 1 Choice",
        type: "MENU",
        dialogueCount: 0,
        chapter: "Chapter 1",
      },
      {
        id: "ch2_start",
        label: "Chapter 2 Start",
        type: "LABEL",
        dialogueCount: 3,
        chapter: "Chapter 2",
      },
      {
        id: "ch2_end",
        label: "Chapter 2 End",
        type: "LABEL",
        dialogueCount: 2,
        chapter: "Chapter 2",
      },
    ];

    const rawEdges: FlowEdge[] = [
      { id: "e1", source: "ch1_start", target: "ch1_choice", kind: "sequence" },
      { id: "e2", source: "ch1_choice", target: "ch2_start", kind: "jump" },
      { id: "e3", source: "ch2_start", target: "ch2_end", kind: "sequence" },
    ];

    const { nodes, edges } = applyDagreLayout(rawNodes, rawEdges, "TB", {
      enableCompoundContainers: true,
    });

    const chapter1 = nodes.find((n) => n.id === "chapter:Chapter 1");
    const chapter2 = nodes.find((n) => n.id === "chapter:Chapter 2");

    expect(chapter1).toBeDefined();
    expect(chapter2).toBeDefined();
    expect(chapter1?.type).toBe("chapterNode");
    expect(chapter2?.type).toBe("chapterNode");

    // Parent container must appear before children
    const ch1Index = nodes.findIndex((n) => n.id === "chapter:Chapter 1");
    const ch1StartIndex = nodes.findIndex((n) => n.id === "ch1_start");
    expect(ch1Index).toBeLessThan(ch1StartIndex);

    // Verify child containment within padding
    const ch1ChildNodes = nodes.filter((n) =>
      n.parentId === "chapter:Chapter 1"
    );
    expect(ch1ChildNodes).toHaveLength(2);

    for (const child of ch1ChildNodes) {
      expect(child.position.x).toBeGreaterThanOrEqual(
        CHAPTER_CONTAINER_PADDING.left,
      );
      expect(child.position.y).toBeGreaterThanOrEqual(
        CHAPTER_CONTAINER_PADDING.top,
      );
      expect(child.position.x + (child.width ?? NODE_WIDTH))
        .toBeLessThanOrEqual(
          (chapter1?.width ?? 0) - CHAPTER_CONTAINER_PADDING.right + 1,
        );
      expect(child.position.y + (child.height ?? 0)).toBeLessThanOrEqual(
        (chapter1?.height ?? 0) - CHAPTER_CONTAINER_PADDING.bottom + 1,
      );
    }

    expect(edges).toHaveLength(3);
  });

  it("handles inter-chapter cycles cleanly without distorting internal ranks", () => {
    const rawNodes: FlowNode[] = [
      {
        id: "c1_a",
        label: "C1 A",
        type: "LABEL",
        dialogueCount: 1,
        chapter: "Ch1",
      },
      {
        id: "c1_b",
        label: "C1 B",
        type: "LABEL",
        dialogueCount: 1,
        chapter: "Ch1",
      },
      {
        id: "c2_a",
        label: "C2 A",
        type: "LABEL",
        dialogueCount: 1,
        chapter: "Ch2",
      },
      {
        id: "c2_b",
        label: "C2 B",
        type: "LABEL",
        dialogueCount: 1,
        chapter: "Ch2",
      },
    ];

    // Cycle: Ch1 -> Ch2 -> Ch1
    const rawEdges: FlowEdge[] = [
      { id: "e1", source: "c1_a", target: "c1_b", kind: "sequence" },
      { id: "e2", source: "c1_b", target: "c2_a", kind: "jump" },
      { id: "e3", source: "c2_a", target: "c2_b", kind: "sequence" },
      { id: "e4", source: "c2_b", target: "c1_a", kind: "jump" },
    ];

    const { nodes, edges } = applyTwoTierDagreLayout(
      rawNodes,
      rawEdges,
      "TB",
      {},
    );

    expect(nodes).toHaveLength(6); // 2 containers + 4 child nodes
    expect(edges).toHaveLength(4);

    const c1A = nodes.find((n) => n.id === "c1_a")!;
    const c1B = nodes.find((n) => n.id === "c1_b")!;

    // Internal rank order in Ch1 remains correct: c1_a before c1_b
    expect(c1A.position.y).toBeLessThan(c1B.position.y);
  });

  it("handles collapsed chapters with summary dimensions", () => {
    const rawNodes: FlowNode[] = [
      {
        id: "c1_a",
        label: "C1 A",
        type: "LABEL",
        dialogueCount: 1,
        chapter: "Ch1",
      },
      {
        id: "c2_a",
        label: "C2 A",
        type: "LABEL",
        dialogueCount: 1,
        chapter: "Ch2",
      },
    ];

    const rawEdges: FlowEdge[] = [
      { id: "e1", source: "c1_a", target: "c2_a", kind: "jump" },
    ];

    const { nodes } = applyTwoTierDagreLayout(rawNodes, rawEdges, "TB", {
      collapsedChapters: { Ch2: true },
    });

    const ch2 = nodes.find((n) => n.id === "chapter:Ch2");
    expect(ch2).toBeDefined();
    expect(ch2?.width).toBe(CHAPTER_SUMMARY_WIDTH);
    expect(ch2?.height).toBe(CHAPTER_SUMMARY_HEIGHT);

    // Ch2 child nodes should be suppressed when collapsed
    const ch2Children = nodes.filter((n) => n.parentId === "chapter:Ch2");
    expect(ch2Children).toHaveLength(0);
  });
});
