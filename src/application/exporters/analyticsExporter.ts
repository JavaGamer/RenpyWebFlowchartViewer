import type { ProjectNarrativeReport } from "../../domain/index.ts";

/**
 * Escapes a cell for CSV export and defends against CSV Formula Injection (CWE-1236).
 * If a cell begins with a formula trigger character (=, +, -, @, \t, \r), it is prefixed with a single quote.
 */
export function escapeCsvCell(val: unknown): string {
  if (val === null || val === undefined) return "";
  let str = String(val);

  // Defend against formula injection
  const formulaTriggers = ["=", "+", "-", "@", "\t", "\r"];
  const trimmed = str.trimStart();
  let needsQuotePrefix = false;
  if (
    str.length > 0 &&
    (formulaTriggers.includes(str[0]!) ||
      (trimmed.length > 0 && formulaTriggers.includes(trimmed[0]!)))
  ) {
    needsQuotePrefix = true;
  }

  const needsQuotes = needsQuotePrefix ||
    str.includes(",") ||
    str.includes('"') ||
    str.includes("\n") ||
    str.includes("\r");

  if (needsQuotes) {
    if (needsQuotePrefix) {
      str = `'${str}`;
    }
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Escapes arbitrary string content for safe inclusion in Markdown table cells.
 * Replaces pipes `|` with `\|` and collapses line breaks.
 */
export function escapeMarkdownTableCell(val: unknown): string {
  if (val === null || val === undefined) return "";
  return String(val)
    .replace(/\|/g, "\\|")
    .replace(/\r?\n|\r/g, " ")
    .trim();
}

export function exportEndingMatrixToCsv(
  report: ProjectNarrativeReport,
): string {
  const headers = [
    "Ending Node ID",
    "Ending Label",
    "Chapter",
    "Classification",
    "Reachable Routes Count",
    "Word Count",
    "Pause Duration (s)",
    "Dialogue Lines",
    "Status",
  ];

  const rows: string[][] = [];

  const allEndings = [
    ...report.reachableEndings,
    ...report.unreachableEndings,
  ];

  for (const ending of allEndings) {
    rows.push([
      escapeCsvCell(ending.nodeId),
      escapeCsvCell(ending.label),
      escapeCsvCell(ending.chapter ?? "Uncategorized"),
      escapeCsvCell(ending.endingType),
      escapeCsvCell(ending.totalReachableRoutes),
      escapeCsvCell(ending.wordCount),
      escapeCsvCell(ending.pauseDuration),
      escapeCsvCell(ending.dialogueCount),
      escapeCsvCell(ending.isOrphan ? "Unreachable (Dead-end)" : "Reachable"),
    ]);
  }

  return [
    headers.join(","),
    ...rows.map((r) => r.join(",")),
  ].join("\n");
}

export function exportRoutesToCsv(report: ProjectNarrativeReport): string {
  const headers = [
    "Route ID",
    "Terminal Ending",
    "Ending Type",
    "Word Count",
    "Estimated Reading Time",
    "Dialogue Lines",
    "Choice Count",
    "Step Count",
    "Has Loop/Cycle",
    "Key Decision Choices",
    "Traversed Chapters",
  ];

  const rows: string[][] = [];

  for (const route of report.routes) {
    const choicesSummary = route.choices
      .map((c) => {
        const cleanChoice = (c.choiceText ?? "Choice").replace(/[\r\n]+/g, " ");
        return `${c.menuLabel} -> [${cleanChoice}]`;
      })
      .join(" | ");

    rows.push([
      escapeCsvCell(route.routeId),
      escapeCsvCell(route.terminalEnding.label),
      escapeCsvCell(route.terminalEnding.endingType),
      escapeCsvCell(route.wordCount),
      escapeCsvCell(route.formattedReadingTime),
      escapeCsvCell(route.dialogueCount),
      escapeCsvCell(route.choices.length),
      escapeCsvCell(route.nodeIds.length),
      escapeCsvCell(route.hasCycle ? "Yes" : "No"),
      escapeCsvCell(choicesSummary),
      escapeCsvCell(route.chaptersTraversed.join(", ")),
    ]);
  }

  return [
    headers.join(","),
    ...rows.map((r) => r.join(",")),
  ].join("\n");
}

export function exportCharacterStatsToCsv(
  report: ProjectNarrativeReport,
): string {
  const headers = [
    "Character / Speaker",
    "Dialogue Line Count",
    "Word Count",
    "Line Share (%)",
    "Word Share (%)",
  ];

  const rows: string[][] = [];

  for (const char of report.characterStats) {
    rows.push([
      escapeCsvCell(char.speaker),
      escapeCsvCell(char.lineCount),
      escapeCsvCell(char.wordCount),
      escapeCsvCell(char.percentageOfLines),
      escapeCsvCell(char.percentageOfWords),
    ]);
  }

  return [
    headers.join(","),
    ...rows.map((r) => r.join(",")),
  ].join("\n");
}

export function exportAnalyticsToMarkdown(
  report: ProjectNarrativeReport,
): string {
  const lines: string[] = [];

  lines.push("# Narrative & Ending Analytics Report\n");

  // 1. Executive Summary
  lines.push("## Executive Summary\n");
  lines.push(`- **Total Story Endings Discovered**: ${report.totalEndings}`);
  lines.push(`- **Reachable Endings**: ${report.reachableEndings.length}`);
  lines.push(
    `- **Unreachable / Orphan Endings**: ${report.unreachableEndings.length}`,
  );
  lines.push(
    `- **Total Distinct Story Routes**: ${report.totalRoutes}${
      report.isTruncated ? " *(enumeration limit reached)*" : ""
    }`,
  );
  lines.push(
    `- **Total Unique Story Words**: ~${report.totalUniqueStoryWords.toLocaleString()} words`,
  );
  lines.push(
    `- **Total Unique Reading Time**: ${report.formattedTotalUniqueReadingTime}`,
  );
  lines.push(
    `- **Average Route Playthrough Duration**: ${report.formattedAverageReadingTime}`,
  );
  if (report.shortestRoute) {
    lines.push(
      `- **Shortest Route**: ${report.shortestRoute.formattedReadingTime} (~${report.shortestRoute.wordCount.toLocaleString()} words, Ending: \`${
        escapeMarkdownTableCell(report.shortestRoute.terminalEnding.label)
      }\`)`,
    );
  }
  if (report.longestRoute) {
    lines.push(
      `- **Longest Route**: ${report.longestRoute.formattedReadingTime} (~${report.longestRoute.wordCount.toLocaleString()} words, Ending: \`${
        escapeMarkdownTableCell(report.longestRoute.terminalEnding.label)
      }\`)`,
    );
  }
  lines.push(
    `- **Global Dialogue-to-Choice Ratio**: ${report.globalDialogueToChoiceRatio} lines/choice`,
  );
  lines.push(
    `- **Global Branching Factor**: ${report.globalBranchingFactor} options/menu\n`,
  );

  // 2. Ending Matrix
  lines.push("## Ending Matrix\n");
  lines.push(
    "| Ending Label | Chapter | Classification | Reachable Routes | Word Count | Dialogue Lines |",
  );
  lines.push("| :--- | :--- | :--- | :---: | :---: | :---: |");
  for (const ending of report.reachableEndings) {
    lines.push(
      `| **${escapeMarkdownTableCell(ending.label)}** | ${
        escapeMarkdownTableCell(ending.chapter ?? "Uncategorized")
      } | \`${ending.endingType}\` | ${ending.totalReachableRoutes} | ${ending.wordCount.toLocaleString()} | ${ending.dialogueCount} |`,
    );
  }
  for (const ending of report.unreachableEndings) {
    lines.push(
      `| ⚠️ **${escapeMarkdownTableCell(ending.label)}** *(unreachable)* | ${
        escapeMarkdownTableCell(ending.chapter ?? "Uncategorized")
      } | \`${ending.endingType}\` | 0 | ${ending.wordCount.toLocaleString()} | ${ending.dialogueCount} |`,
    );
  }
  lines.push("");

  // 3. Points of No Return & Dead Ends
  if (report.pointsOfNoReturn.length > 0) {
    lines.push("## Points of No Return (Choice Lockouts)\n");
    lines.push(
      "Key decision branches that permanently eliminate alternative ending outcomes:\n",
    );
    lines.push(
      "| Menu / Decision | Choice Branch | Target Label | Eliminated Endings | Lock-in Status |",
    );
    lines.push("| :--- | :--- | :--- | :--- | :--- |");
    for (const ponr of report.pointsOfNoReturn) {
      const lockinText = ponr.isEndingLockIn
        ? "**Final Ending Lock-in**"
        : "Eliminates branches";
      lines.push(
        `| \`${escapeMarkdownTableCell(ponr.sourceNodeLabel)}\` | ${
          ponr.choiceText
            ? `"${escapeMarkdownTableCell(ponr.choiceText)}"`
            : "Branch"
        } | \`${escapeMarkdownTableCell(ponr.targetNodeLabel)}\` | \`${
          ponr.eliminatedEndingIds.map((id) => escapeMarkdownTableCell(id))
            .join("`, `")
        }\` | ${lockinText} |`,
      );
    }
    lines.push("");
  }

  // 4. Chapter Pacing & Density
  lines.push("## Chapter Pacing & Dialogue Density\n");
  lines.push(
    "| Chapter | Dialogue Lines | Word Count | Menus | Choices | Dialogue/Choice Ratio | Est. Reading Time | Monologues |",
  );
  lines.push(
    "| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |",
  );
  for (const pacing of Object.values(report.chapterPacing)) {
    const monoText = pacing.monologueSections.length > 0
      ? `⚠️ ${pacing.monologueSections.length} section(s)`
      : "None";
    lines.push(
      `| **${
        escapeMarkdownTableCell(pacing.chapter)
      }** | ${pacing.totalDialogueLines.toLocaleString()} | ${pacing.totalWordCount.toLocaleString()} | ${pacing.totalMenus} | ${pacing.totalChoices} | ${pacing.dialogueToChoiceRatio} | ${pacing.formattedReadingTime} | ${monoText} |`,
    );
  }
  lines.push("");

  // 5. Speaking Character Distribution
  if (report.characterStats.length > 0) {
    lines.push("## Speaking Character Dialogue Breakdown\n");
    lines.push(
      "| Speaker | Line Count | Word Count | Dialogue Share (%) | Word Share (%) |",
    );
    lines.push("| :--- | :---: | :---: | :---: | :---: |");
    for (const char of report.characterStats) {
      lines.push(
        `| **${
          escapeMarkdownTableCell(char.speaker)
        }** | ${char.lineCount.toLocaleString()} | ${char.wordCount.toLocaleString()} | ${char.percentageOfLines}% | ${char.percentageOfWords}% |`,
      );
    }
    lines.push("");
  }

  return lines.join("\n");
}
