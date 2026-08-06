import { describe, expect, it } from "vitest";
import { parseRenpyFiles } from "../../src/parser/parser.ts";
import type { ParseInputFile } from "../../src/parser/pipelineTypes.ts";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const perfOutDir = path.join(repoRoot, "perf-data");
const perfReportPath = path.join(
  perfOutDir,
  "synthetic-benchmark-results.json",
);

// ── 1. Synthetic Script Generator ───────────────────────────────────────────
interface TierConfig {
  name: "Small" | "Medium" | "Stress";
  targetLines: number;
  fileCount: number;
}

const TIERS: TierConfig[] = [
  { name: "Small", targetLines: 5_000, fileCount: 10 },
  { name: "Medium", targetLines: 25_000, fileCount: 50 },
  { name: "Stress", targetLines: 100_000, fileCount: 200 },
];

function generateSyntheticFiles(
  config: TierConfig,
): { files: ParseInputFile[]; totalLines: number } {
  const linesPerFile = Math.ceil(config.targetLines / config.fileCount);
  const files: ParseInputFile[] = [];
  let totalLinesCount = 0;

  for (let f = 0; f < config.fileCount; f++) {
    const fileLines: string[] = [];
    const labelsInFile = Math.max(1, Math.floor(linesPerFile / 15));

    for (let l = 0; l < labelsInFile; l++) {
      const labelId = `f${f}_label_${l}`;
      const nextLabelId = l + 1 < labelsInFile
        ? `f${f}_label_${l + 1}`
        : `f${(f + 1) % config.fileCount}_label_0`;

      fileLines.push(`label ${labelId}:`);
      fileLines.push(`    "Dialogue line A in ${labelId}"`);
      fileLines.push(`    character_a "Dialogue line B in ${labelId}"`);
      fileLines.push(`    $ var_${l % 5} += 1`);

      if (l % 3 === 0) {
        fileLines.push(`    menu:`);
        fileLines.push(`        "Choose Option 1":`);
        fileLines.push(`            jump ${nextLabelId}`);
        fileLines.push(`        "Choose Option 2":`);
        fileLines.push(`            call ${labelId}_sub`);
      } else {
        fileLines.push(`    if var_${l % 5} > 2:`);
        fileLines.push(`        jump ${nextLabelId}`);
        fileLines.push(`    else:`);
        fileLines.push(`        "Fallback dialogue"`);
        fileLines.push(`        jump ${nextLabelId}`);
      }
      fileLines.push(``);
      fileLines.push(`label ${labelId}_sub:`);
      fileLines.push(`    "Subroutine execution"`);
      fileLines.push(`    return`);
      fileLines.push(``);
    }

    const content = fileLines.join("\n");
    totalLinesCount += fileLines.length;
    files.push({
      name: `synthetic_f${String(f).padStart(3, "0")}.rpy`,
      content,
    });
  }

  return { files, totalLines: totalLinesCount };
}

function snapshotMemory() {
  if (globalThis.gc) globalThis.gc();
  const mem = process.memoryUsage();
  return {
    heapUsedMB: Number((mem.heapUsed / (1024 * 1024)).toFixed(2)),
    heapTotalMB: Number((mem.heapTotal / (1024 * 1024)).toFixed(2)),
    rssMB: Number((mem.rss / (1024 * 1024)).toFixed(2)),
  };
}

// ── 2. Benchmark Suite ───────────────────────────────────────────────────────
describe("Synthetic Parser Performance & Memory Benchmarks", () => {
  const benchmarkResults: Array<Record<string, unknown>> = [];

  for (const tier of TIERS) {
    it(
      `benchmarks ${tier.name} tier (~${tier.targetLines.toLocaleString()} lines, ${tier.fileCount} files)`,
      async () => {
        const { files, totalLines } = generateSyntheticFiles(tier);

        const memBefore = snapshotMemory();
        const startTime = performance.now();

        const parseResult = await parseRenpyFiles(files, {
          maxParallelFiles: 4,
          captureDialogueLines: true,
        });

        const parseMs = performance.now() - startTime;
        const memAfter = snapshotMemory();
        const heapDeltaMB = Number(
          (memAfter.heapUsedMB - memBefore.heapUsedMB).toFixed(2),
        );

        const parseSec = parseMs / 1000;
        const linesPerSec = Math.round(totalLines / parseSec);
        const nodesPerSec = Math.round(parseResult.nodes.length / parseSec);

        const resultEntry = {
          tier: tier.name,
          totalLines,
          fileCount: files.length,
          nodeCount: parseResult.nodes.length,
          edgeCount: parseResult.edges.length,
          parseMs: Number(parseMs.toFixed(2)),
          linesPerSec,
          nodesPerSec,
          memBefore,
          memAfter,
          heapDeltaMB,
        };

        benchmarkResults.push(resultEntry);

        // Sanity performance & graph integrity assertions
        expect(parseResult.nodes.length).toBeGreaterThan(0);
        expect(parseResult.edges.length).toBeGreaterThan(0);
        expect(parseResult.nodes.some((n) => n.sourceLocation !== undefined))
          .toBe(true);
        expect(parseResult.edges.some((e) => e.sourceLocation !== undefined))
          .toBe(true);
        expect(parseMs).toBeGreaterThan(0);

        // Performance budget checks
        if (tier.name === "Small") expect(parseMs).toBeLessThan(2_500);
        if (tier.name === "Medium") expect(parseMs).toBeLessThan(10_000);
        if (tier.name === "Stress") expect(parseMs).toBeLessThan(35_000);
      },
      60_000, // 60s timeout per tier test
    );
  }

  it("persists synthetic benchmark metrics report to perf-data/", () => {
    mkdirSync(perfOutDir, { recursive: true });
    writeFileSync(
      perfReportPath,
      JSON.stringify(
        { timestamp: new Date().toISOString(), results: benchmarkResults },
        null,
        2,
      ),
      "utf8",
    );
    expect(benchmarkResults).toHaveLength(TIERS.length);
  });
});
