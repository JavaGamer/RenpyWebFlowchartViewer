import { describe, expect, it } from "vitest";
import {
  type FlowEdge,
  type FlowNode,
  solveRouteToTarget,
} from "../../src/domain/index.ts";

describe("Automated Route Solver (solveRouteToTarget)", () => {
  it("finds linear route to target ending", () => {
    const nodes: FlowNode[] = [
      {
        id: "start",
        type: "LABEL",
        label: "start",
        dialogueCount: 5,
        wordCount: 50,
      },
      {
        id: "scene1",
        type: "LABEL",
        label: "scene1",
        dialogueCount: 10,
        wordCount: 100,
      },
      {
        id: "good_end",
        type: "LABEL",
        label: "good_end",
        dialogueCount: 2,
        wordCount: 20,
        isTerminalOutcome: true,
      },
    ];

    const edges: FlowEdge[] = [
      { id: "e1", source: "start", target: "scene1", kind: "sequence" },
      { id: "e2", source: "scene1", target: "good_end", kind: "jump" },
    ];

    const solved = solveRouteToTarget(nodes, edges, {
      targetNodeId: "good_end",
    });

    expect(solved).not.toBeNull();
    expect(solved!.isReachable).toBe(true);
    expect(solved!.targetLabel).toBe("good_end");
    expect(solved!.totalSteps).toBe(3);
    expect(solved!.totalChoices).toBe(0);
    expect(solved!.totalWordCount).toBe(170);
    expect(solved!.steps.map((s) => s.nodeId)).toEqual([
      "start",
      "scene1",
      "good_end",
    ]);
  });

  it("extracts decision choice steps from branching menus", () => {
    const nodes: FlowNode[] = [
      { id: "start", type: "LABEL", label: "start", dialogueCount: 1 },
      {
        id: "menu_1",
        type: "MENU",
        label: "What should we do today?",
        dialogueCount: 0,
      },
      {
        id: "park_date",
        type: "LABEL",
        label: "park_date",
        dialogueCount: 15,
        wordCount: 150,
      },
      {
        id: "stay_home",
        type: "LABEL",
        label: "stay_home",
        dialogueCount: 5,
        wordCount: 50,
      },
      {
        id: "true_end",
        type: "LABEL",
        label: "true_end",
        dialogueCount: 5,
        wordCount: 40,
        isTerminalOutcome: true,
      },
      {
        id: "bad_end",
        type: "LABEL",
        label: "bad_end",
        dialogueCount: 2,
        wordCount: 15,
        isTerminalOutcome: true,
      },
    ];

    const edges: FlowEdge[] = [
      { id: "e1", source: "start", target: "menu_1", kind: "sequence" },
      {
        id: "e2",
        source: "menu_1",
        target: "park_date",
        kind: "jump",
        label: "Go to the park with Alice",
      },
      {
        id: "e3",
        source: "menu_1",
        target: "stay_home",
        kind: "jump",
        label: "Stay home and sleep",
      },
      { id: "e4", source: "park_date", target: "true_end", kind: "jump" },
      { id: "e5", source: "stay_home", target: "bad_end", kind: "jump" },
    ];

    const solvedTrueEnd = solveRouteToTarget(nodes, edges, {
      targetNodeId: "true_end",
    });

    expect(solvedTrueEnd).not.toBeNull();
    expect(solvedTrueEnd!.isReachable).toBe(true);
    expect(solvedTrueEnd!.totalChoices).toBe(1);
    const choiceStep = solvedTrueEnd!.steps.find((s) => s.type === "choice");
    expect(choiceStep).toBeDefined();
    expect(choiceStep!.choiceText).toBe("Go to the park with Alice");
    expect(choiceStep!.menuLabel).toBe("What should we do today?");

    const solvedBadEnd = solveRouteToTarget(nodes, edges, {
      targetNodeId: "bad_end",
    });
    expect(solvedBadEnd!.isReachable).toBe(true);
    const badChoiceStep = solvedBadEnd!.steps.find((s) => s.type === "choice");
    expect(badChoiceStep!.choiceText).toBe("Stay home and sleep");
  });

  it("handles call and call_return stack frames accurately", () => {
    const nodes: FlowNode[] = [
      { id: "start", type: "LABEL", label: "start", dialogueCount: 1 },
      {
        id: "subroutine",
        type: "LABEL",
        label: "subroutine",
        dialogueCount: 2,
      },
      {
        id: "after_call",
        type: "LABEL",
        label: "after_call",
        dialogueCount: 3,
      },
      {
        id: "ending",
        type: "LABEL",
        label: "ending",
        dialogueCount: 1,
        isTerminalOutcome: true,
      },
    ];

    const edges: FlowEdge[] = [
      {
        id: "e_call",
        source: "start",
        target: "subroutine",
        kind: "call",
        callContext: {
          callContextId: "ctx1",
          callEdgeId: "e_call",
          callSiteId: "start",
          returnTargetId: "after_call",
        },
      },
      {
        id: "e_ret",
        source: "subroutine",
        target: "after_call",
        kind: "call_return",
        callContext: {
          callContextId: "ctx1",
          callEdgeId: "e_call",
          callSiteId: "start",
          returnTargetId: "after_call",
        },
      },
      { id: "e_end", source: "after_call", target: "ending", kind: "jump" },
    ];

    const solved = solveRouteToTarget(nodes, edges, {
      targetNodeId: "ending",
    });

    expect(solved).not.toBeNull();
    expect(solved!.isReachable).toBe(true);
    expect(solved!.steps.map((s) => s.nodeId)).toEqual([
      "start",
      "subroutine",
      "after_call",
      "ending",
    ]);
  });

  it("accumulates required condition flags along path", () => {
    const nodes: FlowNode[] = [
      { id: "start", type: "LABEL", label: "start", dialogueCount: 1 },
      {
        id: "vault_gate",
        type: "DECISION",
        label: "vault_gate",
        dialogueCount: 0,
      },
      {
        id: "vault_interior",
        type: "LABEL",
        label: "vault_interior",
        dialogueCount: 5,
      },
    ];

    const edges: FlowEdge[] = [
      { id: "e1", source: "start", target: "vault_gate", kind: "sequence" },
      {
        id: "e2",
        source: "vault_gate",
        target: "vault_interior",
        kind: "jump",
        condition: {
          branchKind: "if",
          expression: "has_key == True and player_level >= 10",
          references: ["has_key", "player_level"],
        },
      },
    ];

    const solved = solveRouteToTarget(nodes, edges, {
      targetNodeId: "vault_interior",
    });

    expect(solved).not.toBeNull();
    expect(solved!.isReachable).toBe(true);
    expect(solved!.flagsNeeded["has_key"]).toBeDefined();
    expect(solved!.flagsNeeded["player_level"]).toBeDefined();
  });

  it("handles unreachable orphan node returning isReachable: false", () => {
    const nodes: FlowNode[] = [
      { id: "start", type: "LABEL", label: "start", dialogueCount: 1 },
      {
        id: "orphan_secret",
        type: "LABEL",
        label: "orphan_secret",
        dialogueCount: 5,
        isOrphan: true,
      },
    ];

    const edges: FlowEdge[] = [];

    const solved = solveRouteToTarget(nodes, edges, {
      targetNodeId: "orphan_secret",
    });

    expect(solved).not.toBeNull();
    expect(solved!.isReachable).toBe(false);
    expect(solved!.totalSteps).toBe(0);
    expect(solved!.steps).toEqual([]);
  });

  it("differentiates between shortest_steps and least_choices heuristics", () => {
    // Short path with 2 choices:
    // start -> m1 (choice) -> m2 (choice) -> end (length: 4 nodes, 2 choices)
    // Long path with 0 choices:
    // start -> p1 -> p2 -> p3 -> p4 -> end (length: 6 nodes, 0 choices)
    const nodes: FlowNode[] = [
      { id: "start", type: "LABEL", label: "start" },
      { id: "m1", type: "MENU", label: "menu 1" },
      { id: "m2", type: "MENU", label: "menu 2" },
      { id: "p1", type: "LABEL", label: "path 1" },
      { id: "p2", type: "LABEL", label: "path 2" },
      { id: "p3", type: "LABEL", label: "path 3" },
      { id: "p4", type: "LABEL", label: "path 4" },
      { id: "end", type: "LABEL", label: "end", isTerminalOutcome: true },
    ];

    const edges: FlowEdge[] = [
      // Branch 1: menus
      { id: "e_start_m1", source: "start", target: "m1", kind: "jump" },
      {
        id: "e_m1_m2",
        source: "m1",
        target: "m2",
        kind: "jump",
        label: "Choose A",
      },
      {
        id: "e_m2_end",
        source: "m2",
        target: "end",
        kind: "jump",
        label: "Choose B",
      },
      // Branch 2: linear path
      { id: "e_start_p1", source: "start", target: "p1", kind: "jump" },
      { id: "e_p1_p2", source: "p1", target: "p2", kind: "jump" },
      { id: "e_p2_p3", source: "p2", target: "p3", kind: "jump" },
      { id: "e_p3_p4", source: "p3", target: "p4", kind: "jump" },
      { id: "e_p4_end", source: "p4", target: "end", kind: "jump" },
    ];

    const shortest = solveRouteToTarget(nodes, edges, {
      targetNodeId: "end",
      heuristic: "shortest_steps",
    });
    expect(shortest).not.toBeNull();
    expect(shortest!.isReachable).toBe(true);
    expect(shortest!.nodeIds).toEqual(["start", "m1", "m2", "end"]);
    expect(shortest!.totalChoices).toBe(2);

    const direct = solveRouteToTarget(nodes, edges, {
      targetNodeId: "end",
      heuristic: "least_choices",
    });
    expect(direct).not.toBeNull();
    expect(direct!.isReachable).toBe(true);
    expect(direct!.nodeIds).toEqual(["start", "p1", "p2", "p3", "p4", "end"]);
    expect(direct!.totalChoices).toBe(0);
  });

  it("strictly isolates return edges across multiple callers of a shared subroutine", () => {
    // start -> call_a -> shared_sub -> return_a -> dead_end
    // start -> call_b -> shared_sub -> return_b -> target_goal
    const nodes: FlowNode[] = [
      { id: "start", type: "LABEL", label: "start" },
      { id: "call_a", type: "LABEL", label: "call_a" },
      { id: "call_b", type: "LABEL", label: "call_b" },
      { id: "shared_sub", type: "LABEL", label: "shared_sub" },
      { id: "return_a", type: "LABEL", label: "return_a" },
      { id: "return_b", type: "LABEL", label: "return_b" },
      { id: "dead_end", type: "LABEL", label: "dead_end" },
      {
        id: "target_goal",
        type: "LABEL",
        label: "target_goal",
        isTerminalOutcome: true,
      },
    ];

    const edges: FlowEdge[] = [
      { id: "e1", source: "start", target: "call_a", kind: "jump" },
      { id: "e2", source: "start", target: "call_b", kind: "jump" },
      {
        id: "call_from_a",
        source: "call_a",
        target: "shared_sub",
        kind: "call",
        callContext: {
          callContextId: "ctx_a",
          callEdgeId: "call_from_a",
          callSiteId: "call_a",
          returnTargetId: "return_a",
        },
      },
      {
        id: "call_from_b",
        source: "call_b",
        target: "shared_sub",
        kind: "call",
        callContext: {
          callContextId: "ctx_b",
          callEdgeId: "call_from_b",
          callSiteId: "call_b",
          returnTargetId: "return_b",
        },
      },
      {
        id: "ret_to_a",
        source: "shared_sub",
        target: "return_a",
        kind: "call_return",
        callContext: {
          callContextId: "ctx_a",
          callEdgeId: "call_from_a",
          callSiteId: "call_a",
          returnTargetId: "return_a",
        },
      },
      {
        id: "ret_to_b",
        source: "shared_sub",
        target: "return_b",
        kind: "call_return",
        callContext: {
          callContextId: "ctx_b",
          callEdgeId: "call_from_b",
          callSiteId: "call_b",
          returnTargetId: "return_b",
        },
      },
      { id: "e_a_dead", source: "return_a", target: "dead_end", kind: "jump" },
      {
        id: "e_b_goal",
        source: "return_b",
        target: "target_goal",
        kind: "jump",
      },
    ];

    const solved = solveRouteToTarget(nodes, edges, {
      targetNodeId: "target_goal",
    });

    expect(solved).not.toBeNull();
    expect(solved!.isReachable).toBe(true);
    // Path MUST use call_b, not call_a
    expect(solved!.nodeIds).toEqual([
      "start",
      "call_b",
      "shared_sub",
      "return_b",
      "target_goal",
    ]);
  });
});
