import { describe, expect, it } from "vitest";
import type { ProjectNarrativeReport } from "../../src/domain/index.ts";
import {
  escapeCsvCell,
  escapeMarkdownTableCell,
  exportAnalyticsToMarkdown,
  exportCharacterStatsToCsv,
  exportEndingMatrixToCsv,
  exportRoutesToCsv,
} from "../../src/application/exporters/index.ts";

describe("analyticsExporter", () => {
  const sampleReport: ProjectNarrativeReport = {
    totalEndings: 2,
    reachableEndings: [
      {
        nodeId: "good_ending",
        label: "good_ending",
        chapter: "ending",
        endingType: "good",
        isTerminalOutcome: true,
        isOrphan: false,
        wordCount: 500,
        pauseDuration: 2,
        dialogueCount: 20,
        totalReachableRoutes: 1,
      },
    ],
    unreachableEndings: [
      {
        nodeId: "dead_end",
        label: "dead_end",
        chapter: "chapter1",
        endingType: "dead_end",
        isTerminalOutcome: true,
        isOrphan: true,
        wordCount: 10,
        pauseDuration: 0,
        dialogueCount: 2,
        totalReachableRoutes: 0,
      },
    ],
    totalRoutes: 1,
    routes: [
      {
        routeId: "route_1",
        terminalEnding: {
          nodeId: "good_ending",
          label: "good_ending",
          chapter: "ending",
          endingType: "good",
          isTerminalOutcome: true,
          isOrphan: false,
          wordCount: 500,
          pauseDuration: 2,
          dialogueCount: 20,
          totalReachableRoutes: 1,
        },
        nodeIds: ["start", "good_ending"],
        edgeIds: ["e1"],
        choices: [
          {
            menuNodeId: "menu_1",
            menuLabel: "Choice",
            edgeId: "e1",
            choiceText: "Accept",
            targetNodeId: "good_ending",
            targetNodeLabel: "good_ending",
          },
        ],
        wordCount: 500,
        pauseDuration: 2,
        dialogueCount: 20,
        readingTimeSeconds: 152,
        formattedReadingTime: "3m",
        chaptersTraversed: ["prologue", "ending"],
        hasCycle: false,
      },
    ],
    shortestRoute: null,
    longestRoute: null,
    averageReadingTimeSeconds: 152,
    formattedAverageReadingTime: "3m",
    totalUniqueStoryWords: 500,
    totalUniqueReadingTimeSeconds: 152,
    formattedTotalUniqueReadingTime: "3m",
    globalDialogueToChoiceRatio: 20,
    globalBranchingFactor: 1.5,
    pointsOfNoReturn: [
      {
        edgeId: "e1",
        sourceNodeId: "menu_1",
        sourceNodeLabel: "menu_1",
        targetNodeId: "good_ending",
        targetNodeLabel: "good_ending",
        choiceText: "Accept",
        isEndingLockIn: true,
        priorReachableEndingIds: ["good_ending", "bad_ending"],
        remainingReachableEndingIds: ["good_ending"],
        eliminatedEndingIds: ["bad_ending"],
      },
    ],
    chapterPacing: {
      prologue: {
        chapter: "prologue",
        totalDialogueLines: 20,
        totalWordCount: 500,
        totalMenus: 1,
        totalChoices: 2,
        dialogueToChoiceRatio: 20,
        readingTimeSeconds: 152,
        formattedReadingTime: "3m",
        monologueSections: [],
        longestMonologueLines: 0,
        longestMonologueWords: 0,
      },
    },
    characterStats: [
      {
        speaker: "e",
        lineCount: 20,
        wordCount: 500,
        percentageOfLines: 100,
        percentageOfWords: 100,
      },
    ],
    isTruncated: false,
  };

  describe("escapeCsvCell", () => {
    it("escapes CSV injection prefixes (CWE-1236)", () => {
      expect(escapeCsvCell("=1+1")).toBe('"\'=1+1"');
      expect(escapeCsvCell("+cmd|' /C calc'!A0")).toBe(
        "\"'+cmd|' /C calc'!A0\"",
      );
      expect(escapeCsvCell("-123")).toBe('"\'-123"');
      expect(escapeCsvCell("@SUM(A1:A10)")).toBe('"\'@SUM(A1:A10)"');
      expect(escapeCsvCell("\tmalicious")).toBe('"\'\tmalicious"');
    });

    it("escapes quotes and newlines properly", () => {
      expect(escapeCsvCell('Hello "World"')).toBe('"Hello ""World"""');
      expect(escapeCsvCell("Line 1\nLine 2")).toBe('"Line 1\nLine 2"');
      expect(escapeCsvCell(null)).toBe("");
      expect(escapeCsvCell(undefined)).toBe("");
    });
  });

  describe("escapeMarkdownTableCell", () => {
    it("escapes pipes and strips newlines", () => {
      expect(escapeMarkdownTableCell("Speaker | Name")).toBe(
        "Speaker \\| Name",
      );
      expect(escapeMarkdownTableCell("Line 1\nLine 2")).toBe("Line 1 Line 2");
      expect(escapeMarkdownTableCell(null)).toBe("");
    });
  });

  describe("exportEndingMatrixToCsv", () => {
    it("generates CSV with ending headers and rows", () => {
      const csv = exportEndingMatrixToCsv(sampleReport);
      expect(csv).toContain(
        "Ending Node ID,Ending Label,Chapter,Classification",
      );
      expect(csv).toContain(
        "good_ending,good_ending,ending,good,1,500,2,20,Reachable",
      );
      expect(csv).toContain(
        "dead_end,dead_end,chapter1,dead_end,0,10,0,2,Unreachable (Dead-end)",
      );
    });
  });

  describe("exportRoutesToCsv", () => {
    it("generates CSV with route details and choice sequences", () => {
      const csv = exportRoutesToCsv(sampleReport);
      expect(csv).toContain("Route ID,Terminal Ending,Ending Type,Word Count");
      expect(csv).toContain("route_1,good_ending,good,500,3m,20,1,2,No");
      expect(csv).toContain("Choice -> [Accept]");
    });
  });

  describe("exportCharacterStatsToCsv", () => {
    it("generates CSV with character dialogue statistics", () => {
      const csv = exportCharacterStatsToCsv(sampleReport);
      expect(csv).toContain(
        "Character / Speaker,Dialogue Line Count,Word Count",
      );
      expect(csv).toContain("e,20,500,100,100");
    });
  });

  describe("exportAnalyticsToMarkdown", () => {
    it("generates a formatted Markdown report with all sections", () => {
      const md = exportAnalyticsToMarkdown(sampleReport);
      expect(md).toContain("# Narrative & Ending Analytics Report");
      expect(md).toContain("## Executive Summary");
      expect(md).toContain("## Ending Matrix");
      expect(md).toContain("## Points of No Return (Choice Lockouts)");
      expect(md).toContain("## Chapter Pacing & Dialogue Density");
      expect(md).toContain("## Speaking Character Dialogue Breakdown");
      expect(md).toContain("**good_ending**");
      expect(md).toContain("`bad_ending`");
      expect(md).toContain("**Final Ending Lock-in**");
    });

    it("escapes malicious Markdown table content properly", () => {
      const maliciousReport: ProjectNarrativeReport = {
        ...sampleReport,
        reachableEndings: [
          {
            ...sampleReport.reachableEndings[0]!,
            label: "Ending | Injected Column |",
          },
        ],
        characterStats: [
          {
            speaker: "Villain | Fake Column",
            lineCount: 10,
            wordCount: 100,
            percentageOfLines: 50,
            percentageOfWords: 50,
          },
        ],
      };

      const md = exportAnalyticsToMarkdown(maliciousReport);
      expect(md).toContain("Ending \\| Injected Column \\|");
      expect(md).toContain("Villain \\| Fake Column");
    });
  });
});
