import { describe, expect, it } from "vitest";
import type { SolvedWalkthrough } from "../../src/domain/index.ts";
import {
  exportWalkthroughToMarkdown,
  exportWalkthroughToSteamGuide,
  exportWalkthroughToText,
} from "../../src/application/exporters/walkthroughExporter.ts";

describe("Walkthrough Exporters", () => {
  const sampleWalkthrough: SolvedWalkthrough = {
    targetNodeId: "true_end",
    targetLabel: "true_end",
    isReachable: true,
    endingType: "true",
    totalSteps: 3,
    totalChoices: 1,
    totalWordCount: 500,
    totalPauseDuration: 2.0,
    totalDialogueCount: 25,
    readingTimeSeconds: 152,
    formattedReadingTime: "3m",
    chaptersTraversed: ["chapter1.rpy", "chapter2.rpy"],
    steps: [
      {
        stepIndex: 1,
        type: "start",
        nodeId: "start",
        nodeLabel: "start",
        chapter: "chapter1.rpy",
        dialogueCount: 5,
        wordCount: 100,
      },
      {
        stepIndex: 2,
        type: "choice",
        nodeId: "scene_truth",
        nodeLabel: "scene_truth",
        menuLabel: "Confess truth?",
        choiceText: "Tell the complete truth",
        chapter: "chapter2.rpy",
        dialogueCount: 15,
        wordCount: 300,
      },
      {
        stepIndex: 3,
        type: "ending",
        nodeId: "true_end",
        nodeLabel: "true_end",
        chapter: "chapter2.rpy",
        dialogueCount: 5,
        wordCount: 100,
      },
    ],
    nodeIds: ["start", "scene_truth", "true_end"],
    edgeIds: ["e1", "e2"],
    flagsNeeded: {
      honesty_points: "honesty_points >= 5",
      has_evidence: true,
    },
    alternativeRoutesCount: 1,
  };

  it("exports walkthrough to markdown checklist format", () => {
    const md = exportWalkthroughToMarkdown(sampleWalkthrough);
    expect(md).toContain("# Walkthrough Guide: true_end");
    expect(md).toContain("- **Target Ending / Label**: `true_end`");
    expect(md).toContain("- **Ending Classification**: `true`");
    expect(md).toContain("## Required Condition Flags & Variables");
    expect(md).toContain("| `honesty_points` | `honesty_points >= 5` |");
    expect(md).toContain("| `has_evidence` | `true` |");
    expect(md).toContain("## Step-by-Step Decision Checklist");
    expect(md).toContain("- [ ] **Step 1**: Begin new game at `start`");
    expect(md).toContain(
      '- [ ] **Step 2**: At menu **Confess truth?**, choose: **"Tell the complete truth"**',
    );
    expect(md).toContain(
      "- [x] **Goal**: Reach **`true_end`** *(Ending unlocked!)* 🎉",
    );
  });

  it("exports walkthrough to Steam Guide BBCode format", () => {
    const steam = exportWalkthroughToSteamGuide(sampleWalkthrough);
    expect(steam).toContain("[h1]Walkthrough: true_end[/h1]");
    expect(steam).toContain("[b]Summary[/b]");
    expect(steam).toContain("• Target Outcome: [b]true_end[/b]");
    expect(steam).toContain("[h2]Step-by-Step Choices[/h2]");
    expect(steam).toContain(
      'Menu [b]Confess truth?[/b]: Select [spoiler]"Tell the complete truth"[/spoiler]',
    );
  });

  it("exports walkthrough to plain text ASCII format", () => {
    const text = exportWalkthroughToText(sampleWalkthrough);
    expect(text).toContain("WALKTHROUGH GUIDE: TRUE_END");
    expect(text).toContain("Target: true_end");
    expect(text).toContain("REQUIRED FLAGS:");
    expect(text).toContain("  - honesty_points: honesty_points >= 5");
    expect(text).toContain("CHOICE STEPS:");
    expect(text).toContain(
      'At "Confess truth?" -> CHOOSE: "Tell the complete truth"',
    );
    expect(text).toContain(">>> UNLOCKED ENDING: true_end <<<");
  });
});
