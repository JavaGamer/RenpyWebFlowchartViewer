import { describe, expect, it } from "vitest";
import { computeGraphDiff } from "../../src/domain/transforms/graphDiff.ts";
import type { FlowNode } from "../../src/domain/index.ts";

describe("Phase 2 Graph Diffing (microdiff)", () => {
  it("detects added, removed, modified, and unchanged nodes", () => {
    const baseNodes: FlowNode[] = [
      { id: "lbl_start", type: "LABEL", label: "start", dialogueCount: 5 },
      { id: "lbl_old", type: "LABEL", label: "old label", dialogueCount: 2 },
      { id: "lbl_same", type: "LABEL", label: "same label", dialogueCount: 1 },
    ];

    const compareNodes: FlowNode[] = [
      { id: "lbl_start", type: "LABEL", label: "start modified", dialogueCount: 8 }, // Modified
      { id: "lbl_new", type: "LABEL", label: "new label", dialogueCount: 3 }, // Added
      { id: "lbl_same", type: "LABEL", label: "same label", dialogueCount: 1 }, // Unchanged
    ];

    const diffResult = computeGraphDiff(baseNodes, compareNodes);

    expect(diffResult.addedNodeIds).toEqual(["lbl_new"]);
    expect(diffResult.removedNodeIds).toEqual(["lbl_old"]);
    expect(diffResult.modifiedNodeIds).toEqual(["lbl_start"]);
    expect(diffResult.unchangedNodeIds).toEqual(["lbl_same"]);
  });
});
