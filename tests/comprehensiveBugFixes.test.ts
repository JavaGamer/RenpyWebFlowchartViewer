import { describe, expect, it } from "vitest";
import {
  extractScreenActionTarget,
} from "../src/parser/handlers/screen/screenActionExtractor.ts";
import {
  extractMenuOptionCondition,
} from "../src/parser/tokenHandlers/menuTokenHandler.ts";
import {
  parseCallArguments,
  parseLabelParameters,
} from "../src/parser/handlers/jumpCallArgs.ts";
import {
  stripInlineComment,
} from "../src/parser/handlers/screen/screenHandlerEntry.ts";
import { findTopLevelHeaderColon } from "../src/parser/scanTransitions.ts";
import { evaluateConditionExpression } from "../src/domain/conditionLogic.ts";
import { solveRouteToTarget } from "../src/domain/analytics/routeSolver.ts";
import {
  redirectEdgesForCollapsedChapters,
} from "../src/domain/transforms/chapterGrouping.ts";
import {
  exportToMermaid,
} from "../src/application/exporters/mermaidExporter.ts";
import {
  exportToStoryboard,
} from "../src/application/exporters/storyboardExporter.ts";
import {
  exportWalkthroughToMarkdown,
} from "../src/application/exporters/walkthroughExporter.ts";
import { resolveGithubUrl } from "../src/application/urlImporter.ts";
import { createAppStore } from "../src/application/appStore.ts";
import { useViewerStore } from "../src/application/viewerStore.ts";
import {
  computeChapterPacing,
} from "../src/domain/analytics/pacingAnalysis.ts";
import type { FlowEdge, FlowNode } from "../src/domain/index.ts";

describe("Comprehensive Bug Fixes & Regressions", () => {
  describe("Parser fixes", () => {
    it("extractScreenActionTarget handles positional arguments before keyword arguments", () => {
      const target = extractScreenActionTarget(
        `"act2_intro", from_current=True`,
      );
      expect(target).toBe('"act2_intro"');
    });

    it("extractMenuOptionCondition extracts outer condition despite inner ternary", () => {
      const cond = extractMenuOptionCondition(
        `"Option [var if flag else other]" if score > 5:`,
      );
      expect(cond).toBe("score > 5");
    });

    it("parseLabelParameters and parseCallArguments support dot-qualified names", () => {
      const labelParams = parseLabelParameters("label .sub_route(a=1, b=2):");
      expect(labelParams).toHaveLength(2);
      expect(labelParams?.[0]?.name).toBe("a");
      expect(labelParams?.[0]?.defaultValue).toBe("1");

      const callArgs = parseCallArguments(
        "call chapter1.scene2(10, fast=True)",
      );
      expect(callArgs).toHaveLength(2);
      expect(callArgs?.[0]?.value).toBe("10");
      expect(callArgs?.[1]?.name).toBe("fast");
    });

    it("stripInlineComment resets single-line string quote tracking across newlines", () => {
      const code =
        `text "Unclosed quote on line 1\ntext "Valid on line 2" # Comment`;
      const stripped = stripInlineComment(code);
      expect(stripped).toContain(`text "Valid on line 2"`);
      expect(stripped).not.toContain("# Comment");
    });

    it("findTopLevelHeaderColon ignores walrus operator := in header colons", () => {
      const line = "if (x := get_val()) > 0:";
      const colonIdx = findTopLevelHeaderColon(line);
      expect(colonIdx).toBe(line.length - 1);
    });
  });

  describe("Domain & Condition Logic fixes", () => {
    it("evaluates arithmetic operators and relational booleans correctly", () => {
      const vars = { flag: "true", count: "5", bonus: "3" };
      expect(evaluateConditionExpression("flag > 0", vars)).toBe("true");
      expect(evaluateConditionExpression("count + bonus == 8", vars)).toBe(
        "true",
      );
      expect(evaluateConditionExpression("count * 2 == 10", vars)).toBe("true");
      expect(evaluateConditionExpression("count % 2 == 1", vars)).toBe("true");
    });

    it("redirectEdgesForCollapsedChapters only deduplicates edges touching collapsed chapters", () => {
      const nodes: FlowNode[] = [
        {
          id: "ch1_node1",
          label: "Node 1",
          type: "LABEL",
          chapter: "Ch1",
          dialogueCount: 0,
        },
        {
          id: "ch1_node2",
          label: "Node 2",
          type: "LABEL",
          chapter: "Ch1",
          dialogueCount: 0,
        },
        {
          id: "other_node1",
          label: "Other 1",
          type: "LABEL",
          chapter: "Ch2",
          dialogueCount: 0,
        },
        {
          id: "other_node2",
          label: "Other 2",
          type: "LABEL",
          chapter: "Ch2",
          dialogueCount: 0,
        },
      ];
      const edges: FlowEdge[] = [
        { id: "e1", source: "ch1_node1", target: "other_node1", kind: "jump" },
        {
          id: "e2",
          source: "other_node1",
          target: "other_node2",
          kind: "choice",
          label: "Choice A",
        },
        {
          id: "e3",
          source: "other_node1",
          target: "other_node2",
          kind: "choice",
          label: "Choice B",
        },
      ];
      const collapsed = { Ch1: true };
      const redirected = redirectEdgesForCollapsedChapters(
        edges,
        nodes,
        collapsed,
      );
      // Choice A and Choice B between other_node1 and other_node2 in uncollapsed Ch2 must both be preserved
      expect(redirected.filter((e) => e.target === "other_node2")).toHaveLength(
        2,
      );
    });

    it("solveRouteToTarget finds shortest steps globally across multiple entry points", () => {
      const nodes: FlowNode[] = [
        {
          id: "entry_long",
          label: "start_long",
          type: "LABEL",
          role: "story",
          dialogueCount: 0,
        },
        {
          id: "mid1",
          label: "mid1",
          type: "LABEL",
          role: "story",
          dialogueCount: 0,
        },
        {
          id: "mid2",
          label: "mid2",
          type: "LABEL",
          role: "story",
          dialogueCount: 0,
        },
        {
          id: "entry_short",
          label: "start_short",
          type: "LABEL",
          role: "story",
          dialogueCount: 0,
        },
        {
          id: "target",
          label: "target_scene",
          type: "LABEL",
          role: "story",
          dialogueCount: 0,
        },
      ];
      const edges: FlowEdge[] = [
        { id: "e1", source: "entry_long", target: "mid1", kind: "sequence" },
        { id: "e2", source: "mid1", target: "mid2", kind: "sequence" },
        { id: "e3", source: "mid2", target: "target", kind: "sequence" },
        { id: "e4", source: "entry_short", target: "target", kind: "sequence" },
      ];
      const result = solveRouteToTarget(nodes, edges, {
        targetNodeId: "target",
        heuristic: "shortest_steps",
      });
      expect(result).not.toBeNull();
      expect(result?.isReachable).toBe(true);
      // Optimal path from entry_short is 2 steps (entry_short -> target)
      expect(result?.totalSteps).toBe(2);
      expect(result?.nodeIds[0]).toBe("entry_short");
    });

    it("computeChapterPacing indexes choices correctly in linear time", () => {
      const nodes: FlowNode[] = [
        {
          id: "n1",
          label: "Scene 1",
          type: "LABEL",
          chapter: "Intro",
          dialogueCount: 5,
          wordCount: 50,
        },
        {
          id: "n2",
          label: "Menu 1",
          type: "MENU",
          chapter: "Intro",
          dialogueCount: 1,
          wordCount: 10,
        },
        {
          id: "n3",
          label: "Scene 2",
          type: "LABEL",
          chapter: "Intro",
          dialogueCount: 10,
          wordCount: 100,
        },
      ];
      const edges: FlowEdge[] = [
        { id: "e1", source: "n1", target: "n2", kind: "sequence" },
        {
          id: "e2",
          source: "n2",
          target: "n3",
          kind: "choice",
          label: "Go scene 2",
        },
      ];
      const stats = computeChapterPacing(nodes, edges, 150);
      expect(stats["Intro"]?.totalChoices).toBe(1);
      expect(stats["Intro"]?.totalMenus).toBe(1);
      expect(stats["Intro"]?.totalDialogueLines).toBe(16);
    });
  });

  describe("Application & Store fixes", () => {
    it("appPhaseSlice reset clears translations and availableLanguages", () => {
      const store = createAppStore();
      store.getState().parseSuccess(
        [{ id: "n1", label: "start", type: "LABEL", dialogueCount: 0 }],
        [],
        [],
        {
          defaultLanguage: "None",
          availableLanguages: ["es", "fr"],
          translationsByLanguage: {},
        },
      );
      expect(store.getState().availableLanguages).toEqual(["es", "fr"]);

      store.getState().reset();
      expect(store.getState().translations).toBeNull();
      expect(store.getState().availableLanguages).toEqual([]);
      expect(store.getState().phase).toBe("idle");
    });

    it("viewerStore setSelectedNodeId resets selectedNodeIds correctly", () => {
      useViewerStore.getState().setSelectedNodeIds(["node1", "node2"]);
      expect(useViewerStore.getState().selectedNodeIds).toHaveLength(2);

      useViewerStore.getState().setSelectedNodeId("node3");
      expect(useViewerStore.getState().selectedNodeId).toBe("node3");
      expect(useViewerStore.getState().selectedNodeIds).toEqual(["node3"]);

      useViewerStore.getState().setSelectedNodeId(null);
      expect(useViewerStore.getState().selectedNodeId).toBeNull();
      expect(useViewerStore.getState().selectedNodeIds).toEqual([]);
    });

    it("resolveGithubUrl resolves repository tree URLs to branch archives", () => {
      const url = "https://github.com/example-user/my-game/tree/feature-branch";
      const resolved = resolveGithubUrl(url);
      expect(resolved).toBe(
        "https://github.com/example-user/my-game/archive/refs/heads/feature-branch.zip",
      );
    });
  });

  describe("Exporters fixes", () => {
    it("exportToMermaid escapes HTML entities and bracket delimiters", () => {
      const nodes: FlowNode[] = [
        {
          id: "n1",
          label: "Node <with> [brackets] {curly}",
          type: "LABEL",
          dialogueCount: 0,
        },
      ];
      const edges: FlowEdge[] = [];
      const mmd = exportToMermaid(nodes, edges);
      expect(mmd).toContain("&lt;with&gt;");
      expect(mmd).toContain("#91;brackets#93;");
      expect(mmd).toContain("#123;curly#125;");
    });

    it("exportToStoryboard sanitizes headings", () => {
      const nodes: FlowNode[] = [
        {
          id: "n1",
          label: "### Raw Heading Label",
          type: "LABEL",
          chapter: "## Chapter 1",
          dialogueCount: 1,
          dialogueLines: ["Hello world"],
        },
      ];
      const sb = exportToStoryboard(nodes);
      expect(sb).toContain("## Chapter 1\n");
      expect(sb).toContain("### Raw Heading Label");
    });

    it("exportWalkthroughToMarkdown escapes code spans and headings", () => {
      const md = exportWalkthroughToMarkdown({
        targetNodeId: "target",
        targetLabel: "Target `Special` Ending",
        isReachable: true,
        totalSteps: 1,
        totalChoices: 0,
        totalWordCount: 100,
        totalPauseDuration: 0,
        totalDialogueCount: 10,
        readingTimeSeconds: 60,
        formattedReadingTime: "1m",
        chaptersTraversed: [],
        steps: [
          {
            stepIndex: 1,
            type: "start",
            nodeId: "target",
            nodeLabel: "Target `Special` Ending",
            dialogueCount: 10,
            wordCount: 100,
          },
        ],
        nodeIds: ["target"],
        edgeIds: [],
        flagsNeeded: {},
        alternativeRoutesCount: 1,
      });
      expect(md).toContain("Target \\`Special\\` Ending");
    });

    it("exportToHtmlBundle sanitizes non-svg data URLs safely", async () => {
      const { exportToHtmlBundle } = await import(
        "../src/application/exporters/htmlExporter.ts"
      );
      const html = exportToHtmlBundle("javascript:alert(1)");
      expect(html).toContain('src=""');
    });

    it("escapeCsvCell prevents CSV injection with leading whitespace", async () => {
      const { escapeCsvCell } = await import(
        "../src/application/exporters/analyticsExporter.ts"
      );
      expect(escapeCsvCell("  =cmd|' /C calc'!A0")).toBe(
        `"'  =cmd|' /C calc'!A0"`,
      );
      expect(escapeCsvCell("   @SUM(1,2)")).toBe(`"'   @SUM(1,2)"`);
    });

    it("resolveGithubUrl handles branch names with slashes", () => {
      const parsed = resolveGithubUrl(
        "https://github.com/owner/repo/tree/feature/sub-branch",
      );
      expect(parsed).toBe(
        "https://github.com/owner/repo/archive/refs/heads/feature/sub-branch.zip",
      );
    });

    it("pythonAstEvaluator supports commutative string multiplication", async () => {
      const { evaluatePythonAstExpression } = await import(
        "../src/domain/pythonAstEvaluator.ts"
      );
      expect(evaluatePythonAstExpression('3 * "abc"', {}).value).toBe(
        "abcabcabc",
      );
      expect(evaluatePythonAstExpression('"xyz" * 2', {}).value).toBe("xyzxyz");
    });
  });
});
