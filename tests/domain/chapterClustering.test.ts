import { describe, expect, it } from "vitest";
import { applyChapterClustering } from "../../src/domain/transforms/chapterClustering.ts";
import type { FlowEdge, FlowNode } from "../../src/domain/graph.ts";

describe("Chapter Container Grouping (applyChapterClustering)", () => {
  it("synthesizes cluster node and reroutes boundary edges when chapter is collapsed", () => {
    const nodes: FlowNode[] = [
      {
        id: "start",
        type: "LABEL",
        label: "start",
        dialogueCount: 5,
        chapter: "ch1",
      },
      {
        id: "scene_1",
        type: "LABEL",
        label: "scene_1",
        dialogueCount: 10,
        chapter: "ch1",
      },
      {
        id: "ch2_intro",
        type: "LABEL",
        label: "ch2_intro",
        dialogueCount: 8,
        chapter: "ch2",
      },
    ];

    const edges: FlowEdge[] = [
      {
        id: "seq_start__scene_1",
        source: "start",
        target: "scene_1",
        kind: "sequence",
      },
      {
        id: "jump_scene_1__ch2_intro",
        source: "scene_1",
        target: "ch2_intro",
        kind: "jump",
      },
    ];

    const collapsedChapters = new Set(["ch1"]);

    const result = applyChapterClustering(nodes, edges, { collapsedChapters });

    expect(result.nodes.map((n) => n.id)).toEqual(["ch2_intro"]);
    expect(result.clusterNodes).toHaveLength(1);
    expect(result.clusterNodes[0].id).toBe("cluster:ch1");
    expect(result.clusterNodes[0].dialogueCount).toBe(15);
    expect(result.clusterNodes[0].nodeCount).toBe(2);

    expect(result.edges).toHaveLength(1);
    expect(result.edges[0].source).toBe("cluster:ch1");
    expect(result.edges[0].target).toBe("ch2_intro");
  });
});
