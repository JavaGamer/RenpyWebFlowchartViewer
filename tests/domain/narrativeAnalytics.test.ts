import { describe, expect, it } from "vitest";
import type { FlowEdge, FlowNode } from "../../src/domain/index.ts";
import {
  classifyEndingTypeHeuristic,
  computeChapterPacing,
  computeCharacterDistribution,
  computeMonologueSections,
  computeReverseReachability,
  discoverTerminalEndings,
  enumerateStoryRoutes,
  generateProjectNarrativeReport,
  identifyPointsOfNoReturn,
} from "../../src/domain/index.ts";

describe("narrativeAnalytics", () => {
  const sampleNodes: FlowNode[] = [
    {
      id: "start",
      type: "LABEL",
      role: "story",
      label: "start",
      chapter: "prologue",
      dialogueCount: 15,
      wordCount: 120,
      characterDialogue: {
        e: { lineCount: 10, wordCount: 80 },
        mc: { lineCount: 5, wordCount: 40 },
      },
    },
    {
      id: "menu_1",
      type: "MENU",
      label: "Choice: Help or Flee",
      chapter: "chapter1",
      dialogueCount: 0,
      wordCount: 0,
    },
    {
      id: "help_branch",
      type: "LABEL",
      role: "story",
      label: "help_branch",
      chapter: "chapter1",
      dialogueCount: 40,
      wordCount: 600,
      characterDialogue: {
        e: { lineCount: 30, wordCount: 450 },
        mc: { lineCount: 10, wordCount: 150 },
      },
    },
    {
      id: "flee_branch",
      type: "LABEL",
      role: "story",
      label: "flee_branch",
      chapter: "chapter1",
      dialogueCount: 5,
      wordCount: 50,
      characterDialogue: {
        mc: { lineCount: 5, wordCount: 50 },
      },
    },
    {
      id: "good_ending",
      type: "LABEL",
      role: "story",
      label: "good_ending",
      chapter: "ending",
      dialogueCount: 20,
      wordCount: 250,
      isTerminalOutcome: true,
      characterDialogue: {
        e: { lineCount: 10, wordCount: 120 },
        mc: { lineCount: 10, wordCount: 130 },
      },
    },
    {
      id: "bad_ending",
      type: "LABEL",
      role: "story",
      label: "bad_ending",
      chapter: "ending",
      dialogueCount: 10,
      wordCount: 90,
      isTerminalOutcome: true,
      characterDialogue: {
        mc: { lineCount: 10, wordCount: 90 },
      },
    },
    {
      id: "orphan_secret_end",
      type: "LABEL",
      role: "story",
      label: "true_secret_ending",
      chapter: "secret",
      dialogueCount: 10,
      wordCount: 100,
      isTerminalOutcome: true,
      isOrphan: true,
    },
  ];

  const sampleEdges: FlowEdge[] = [
    { id: "e1", source: "start", target: "menu_1", kind: "sequence" },
    {
      id: "e2",
      source: "menu_1",
      target: "help_branch",
      label: "Help Eileen",
      kind: "jump",
    },
    {
      id: "e3",
      source: "menu_1",
      target: "flee_branch",
      label: "Run Away",
      kind: "jump",
    },
    {
      id: "e4",
      source: "help_branch",
      target: "good_ending",
      kind: "sequence",
    },
    { id: "e5", source: "flee_branch", target: "bad_ending", kind: "sequence" },
  ];

  describe("classifyEndingTypeHeuristic", () => {
    it("classifies ending types by label name correctly", () => {
      expect(classifyEndingTypeHeuristic("good_ending")).toBe("good");
      expect(classifyEndingTypeHeuristic("bad_end")).toBe("bad");
      expect(classifyEndingTypeHeuristic("true_hero_ending")).toBe("true");
      expect(classifyEndingTypeHeuristic("game_over_scene")).toBe("dead_end");
      expect(classifyEndingTypeHeuristic("normal_ending")).toBe("normal");
    });
  });

  describe("discoverTerminalEndings", () => {
    it("discovers terminal outcomes and splits reachable from orphan endings", () => {
      const { endingMap, reachableEndings, unreachableEndings } =
        discoverTerminalEndings(
          sampleNodes,
          sampleEdges,
        );

      expect(endingMap.size).toBe(3);
      expect(reachableEndings.length).toBe(2);
      expect(unreachableEndings.length).toBe(1);

      const good = endingMap.get("good_ending");
      expect(good).toBeDefined();
      expect(good?.endingType).toBe("good");

      const orphan = endingMap.get("orphan_secret_end");
      expect(orphan).toBeDefined();
      expect(orphan?.isOrphan).toBe(true);
      expect(orphan?.endingType).toBe("true");
    });

    it("respects custom user tag overrides", () => {
      const { endingMap } = discoverTerminalEndings(sampleNodes, sampleEdges, {
        good_ending: "true",
      });
      expect(endingMap.get("good_ending")?.endingType).toBe("true");
    });
  });

  describe("enumerateStoryRoutes", () => {
    it("enumerates all distinct paths from start to terminal endings", () => {
      const { endingMap } = discoverTerminalEndings(sampleNodes, sampleEdges);
      const { routes, isTruncated } = enumerateStoryRoutes(
        sampleNodes,
        sampleEdges,
        endingMap,
      );

      expect(isTruncated).toBe(false);
      expect(routes.length).toBe(2);

      const goodRoute = routes.find((r) =>
        r.terminalEnding.nodeId === "good_ending"
      );
      expect(goodRoute).toBeDefined();
      expect(goodRoute?.nodeIds).toEqual([
        "start",
        "menu_1",
        "help_branch",
        "good_ending",
      ]);
      expect(goodRoute?.choices.length).toBe(1);
      expect(goodRoute?.choices[0]!.choiceText).toBe("Help Eileen");

      const badRoute = routes.find((r) =>
        r.terminalEnding.nodeId === "bad_ending"
      );
      expect(badRoute).toBeDefined();
      expect(badRoute?.nodeIds).toEqual([
        "start",
        "menu_1",
        "flee_branch",
        "bad_ending",
      ]);
      expect(badRoute?.choices.length).toBe(1);
      expect(badRoute?.choices[0]!.choiceText).toBe("Run Away");
    });

    it("safely bounds cyclic jumps without infinite loops", () => {
      const cyclicNodes: FlowNode[] = [
        {
          id: "start",
          type: "LABEL",
          role: "story",
          label: "start",
          dialogueCount: 1,
          wordCount: 10,
        },
        {
          id: "loop_node",
          type: "LABEL",
          role: "story",
          label: "loop_node",
          dialogueCount: 1,
          wordCount: 10,
        },
        {
          id: "ending",
          type: "LABEL",
          role: "story",
          label: "ending",
          isTerminalOutcome: true,
          dialogueCount: 1,
          wordCount: 10,
        },
      ];
      const cyclicEdges: FlowEdge[] = [
        { id: "e1", source: "start", target: "loop_node", kind: "sequence" },
        { id: "e2", source: "loop_node", target: "loop_node", kind: "jump" }, // Self-loop
        { id: "e3", source: "loop_node", target: "ending", kind: "sequence" },
      ];

      const { endingMap } = discoverTerminalEndings(cyclicNodes, cyclicEdges);
      const { routes } = enumerateStoryRoutes(
        cyclicNodes,
        cyclicEdges,
        endingMap,
      );

      expect(routes.length).toBeGreaterThan(0);
      expect(routes.some((r) => r.terminalEnding.nodeId === "ending")).toBe(
        true,
      );
    });
  });

  describe("computeReverseReachability & identifyPointsOfNoReturn", () => {
    it("computes backward reachability sets correctly", () => {
      const { endingMap } = discoverTerminalEndings(sampleNodes, sampleEdges);
      const reachability = computeReverseReachability(
        sampleNodes,
        sampleEdges,
        Array.from(endingMap.keys()),
      );

      const startReachable = reachability.get("start");
      expect(startReachable?.has("good_ending")).toBe(true);
      expect(startReachable?.has("bad_ending")).toBe(true);
      expect(startReachable?.has("orphan_secret_end")).toBe(false);

      const helpReachable = reachability.get("help_branch");
      expect(helpReachable?.has("good_ending")).toBe(true);
      expect(helpReachable?.has("bad_ending")).toBe(false);
    });

    it("identifies choices as points of no return when they eliminate endings", () => {
      const nodeMap = new Map(sampleNodes.map((n) => [n.id, n]));
      const { endingMap } = discoverTerminalEndings(sampleNodes, sampleEdges);
      const reachability = computeReverseReachability(
        sampleNodes,
        sampleEdges,
        Array.from(endingMap.keys()),
      );
      const ponrs = identifyPointsOfNoReturn(
        sampleNodes,
        sampleEdges,
        reachability,
        nodeMap,
      );

      expect(ponrs.length).toBe(2);

      const helpPonr = ponrs.find((p) => p.edgeId === "e2");
      expect(helpPonr).toBeDefined();
      expect(helpPonr?.eliminatedEndingIds).toContain("bad_ending");
      expect(helpPonr?.isEndingLockIn).toBe(true);

      const fleePonr = ponrs.find((p) => p.edgeId === "e3");
      expect(fleePonr).toBeDefined();
      expect(fleePonr?.eliminatedEndingIds).toContain("good_ending");
      expect(fleePonr?.isEndingLockIn).toBe(true);
    });
  });

  describe("computeChapterPacing & Monologue Detection", () => {
    it("detects monologue sections exceeding line/word threshold", () => {
      const monologues = computeMonologueSections(sampleNodes, sampleEdges);
      expect(monologues.length).toBe(1);
      expect(monologues[0]!.startNodeId).toBe("help_branch");
      expect(monologues[0]!.dialogueLineCount).toBe(60);
      expect(monologues[0]!.wordCount).toBe(850);
    });

    it("computes dialogue-to-choice ratio per chapter", () => {
      const pacing = computeChapterPacing(sampleNodes, sampleEdges);
      expect(pacing["chapter1"]).toBeDefined();
      expect(pacing["chapter1"]?.totalMenus).toBe(1);
      expect(pacing["chapter1"]?.totalChoices).toBe(2);
      expect(pacing["chapter1"]?.dialogueToChoiceRatio).toBe(45);
    });
  });

  describe("computeCharacterDistribution", () => {
    it("aggregates project-wide dialogue lines and word counts by character", () => {
      const stats = computeCharacterDistribution(sampleNodes);
      expect(stats.length).toBe(3);

      const eileen = stats.find((s) => s.speaker === "e");
      expect(eileen).toBeDefined();
      expect(eileen?.lineCount).toBe(50);
      expect(eileen?.wordCount).toBe(650);

      const mc = stats.find((s) => s.speaker === "mc");
      expect(mc).toBeDefined();
      expect(mc?.lineCount).toBe(40);
      expect(mc?.wordCount).toBe(460);

      const narrator = stats.find((s) => s.speaker === "narrator");
      expect(narrator).toBeDefined();
      expect(narrator?.lineCount).toBe(10);
      expect(narrator?.wordCount).toBe(100);
    });
  });

  describe("generateProjectNarrativeReport", () => {
    it("generates comprehensive report with speedrun and completionist metrics", () => {
      const report = generateProjectNarrativeReport(sampleNodes, sampleEdges, {
        readingSpeedWpm: 200,
      });

      expect(report.totalEndings).toBe(3);
      expect(report.reachableEndings.length).toBe(2);
      expect(report.unreachableEndings.length).toBe(1);
      expect(report.totalRoutes).toBe(2);
      expect(report.shortestRoute).toBeDefined();
      expect(report.longestRoute).toBeDefined();
      expect(report.shortestRoute?.terminalEnding.nodeId).toBe("bad_ending");
      expect(report.longestRoute?.terminalEnding.nodeId).toBe("good_ending");
      expect(report.pointsOfNoReturn.length).toBe(2);
    });

    it("handles empty graphs without throwing errors or dividing by zero", () => {
      const report = generateProjectNarrativeReport([], []);
      expect(report.totalEndings).toBe(0);
      expect(report.totalRoutes).toBe(0);
      expect(report.shortestRoute).toBeNull();
      expect(report.longestRoute).toBeNull();
      expect(report.globalDialogueToChoiceRatio).toBe(0);
      expect(report.globalBranchingFactor).toBe(0);
    });

    it("evaluates interprocedural CFL-reachability without cross-calling pollution", () => {
      // Subroutine test:
      // entry1 -> call sub (context 1) -> return to branch1 -> ending1
      // entry2 -> call sub (context 2) -> return to branch2 -> ending2
      const cflNodes: FlowNode[] = [
        { id: "entry1", type: "LABEL", role: "story", label: "entry1" },
        { id: "entry2", type: "LABEL", role: "story", label: "entry2" },
        { id: "sub", type: "LABEL", role: "utility", label: "sub" },
        { id: "branch1", type: "LABEL", role: "story", label: "branch1" },
        { id: "branch2", type: "LABEL", role: "story", label: "branch2" },
        {
          id: "ending1",
          type: "LABEL",
          role: "story",
          label: "ending1",
          isTerminalOutcome: true,
        },
        {
          id: "ending2",
          type: "LABEL",
          role: "story",
          label: "ending2",
          isTerminalOutcome: true,
        },
      ];

      const cflEdges: FlowEdge[] = [
        {
          id: "call1",
          source: "entry1",
          target: "sub",
          kind: "call",
          callContext: {
            callContextId: "ctx1",
            callEdgeId: "call1",
            callSiteId: "entry1",
            returnTargetId: "branch1",
          },
        },
        {
          id: "ret1",
          source: "sub",
          target: "branch1",
          kind: "call_return",
          callContext: {
            callContextId: "ctx1",
            callEdgeId: "call1",
            callSiteId: "entry1",
            returnTargetId: "branch1",
          },
        },
        {
          id: "call2",
          source: "entry2",
          target: "sub",
          kind: "call",
          callContext: {
            callContextId: "ctx2",
            callEdgeId: "call2",
            callSiteId: "entry2",
            returnTargetId: "branch2",
          },
        },
        {
          id: "ret2",
          source: "sub",
          target: "branch2",
          kind: "call_return",
          callContext: {
            callContextId: "ctx2",
            callEdgeId: "call2",
            callSiteId: "entry2",
            returnTargetId: "branch2",
          },
        },
        { id: "seq1", source: "branch1", target: "ending1", kind: "sequence" },
        { id: "seq2", source: "branch2", target: "ending2", kind: "sequence" },
      ];

      const { endingMap } = discoverTerminalEndings(cflNodes, cflEdges);
      const reachability = computeReverseReachability(
        cflNodes,
        cflEdges,
        Array.from(endingMap.keys()),
      );

      // entry1 should only reach ending1, NOT ending2
      const entry1Reach = reachability.get("entry1");
      expect(entry1Reach?.has("ending1")).toBe(true);
      expect(entry1Reach?.has("ending2")).toBe(false);

      // entry2 should only reach ending2, NOT ending1
      const entry2Reach = reachability.get("entry2");
      expect(entry2Reach?.has("ending2")).toBe(true);
      expect(entry2Reach?.has("ending1")).toBe(false);
    });

    it("chains monologue sections across unconditional jumps", () => {
      const jumpNodes: FlowNode[] = [
        {
          id: "part1",
          type: "LABEL",
          role: "story",
          label: "part1",
          dialogueCount: 20,
          wordCount: 300,
        },
        {
          id: "part2",
          type: "LABEL",
          role: "story",
          label: "part2",
          dialogueCount: 20,
          wordCount: 300,
        },
      ];
      const jumpEdges: FlowEdge[] = [
        { id: "j1", source: "part1", target: "part2", kind: "jump" },
      ];

      const monologues = computeMonologueSections(jumpNodes, jumpEdges);
      expect(monologues.length).toBe(1);
      expect(monologues[0]!.dialogueLineCount).toBe(40);
      expect(monologues[0]!.wordCount).toBe(600);
      expect(monologues[0]!.nodeCount).toBe(2);
    });
  });
});
