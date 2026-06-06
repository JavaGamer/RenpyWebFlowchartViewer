import { describe, expect, it } from 'vitest';
import {
  readdirSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
} from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { parseRenpyFiles } from '../../src/parser/parser';
import { applyDagreLayout, buildVisibleNodes, buildVisibleEdges } from '../../src/domain';

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(thisDir, '../..');
const perfDataDir = path.join(repoRoot, 'perf-data');
const generatedDataDir = path.join(perfDataDir, 'generated');
const outPath = path.join(perfDataDir, 'baseline-results.json');

function generateDataset(targetDir: string, files: number, labelsPerFile: number, menusEvery: number) {
  mkdirSync(targetDir, { recursive: true });
  for (let fileIndex = 0; fileIndex < files; fileIndex += 1) {
    const lines: string[] = [];
    const defaultLoopTarget = 'f0_label_0';
    for (let labelIndex = 0; labelIndex < labelsPerFile; labelIndex += 1) {
      const label = `f${fileIndex}_label_${labelIndex}`;
      const nextInFile = `f${fileIndex}_label_${labelIndex + 1}`;
      const hasNextInFile = labelIndex + 1 < labelsPerFile;
      const next = hasNextInFile ? nextInFile : defaultLoopTarget;
      lines.push(`label ${label}:`);
      lines.push(`    "line ${labelIndex} a"`);
      lines.push(`    "line ${labelIndex} b"`);
      if (menusEvery > 0 && labelIndex % menusEvery === 0) {
        lines.push('    menu:');
        lines.push('        "Go next":');
        lines.push(`            jump ${next}`);
        lines.push('        "Call util":');
        lines.push(`            call ${label}_util`);
      } else {
        lines.push(`    jump ${next}`);
      }
      lines.push('');
      lines.push(`label ${label}_util:`);
      lines.push('    "utility"');
      lines.push('    return');
      lines.push('');
    }
    const fileName = `chapter_${String(fileIndex).padStart(3, '0')}.rpy`;
    writeFileSync(path.join(targetDir, fileName), lines.join('\n'), 'utf8');
  }
}

function ensureBenchmarkDatasets() {
  const requiredDatasets = ['small', 'medium', 'large', 'nearMax'];
  const missing = requiredDatasets.some((name) => !existsSync(path.join(generatedDataDir, name)));
  if (!missing) return;
  generateDataset(path.join(generatedDataDir, 'small'), 4, 12, 4);
  generateDataset(path.join(generatedDataDir, 'medium'), 18, 20, 3);
  generateDataset(path.join(generatedDataDir, 'large'), 60, 30, 2);
  generateDataset(path.join(generatedDataDir, 'nearMax'), 260, 14, 3);
  writeFileSync(path.join(generatedDataDir, '.generated'), 'generated', 'utf8');
}

function memorySnapshot() {
  const m = process.memoryUsage();
  return {
    rssMB: Number((m.rss / (1024 * 1024)).toFixed(2)),
    heapUsedMB: Number((m.heapUsed / (1024 * 1024)).toFixed(2)),
    heapTotalMB: Number((m.heapTotal / (1024 * 1024)).toFixed(2)),
  };
}

function readDataset(datasetName: string) {
  const dir = path.join(generatedDataDir, datasetName);
  const files = readdirSync(dir).filter((name) => name.endsWith('.rpy')).sort();
  const started = performance.now();
  const entries = files.map((name) => ({
    name,
    content: readFileSync(path.join(dir, name), 'utf8'),
  }));
  const readMs = performance.now() - started;
  return { entries, readMs };
}

describe('performance baseline benchmarks', () => {
  it(
    'captures baseline timings for small/medium/large datasets',
    async () => {
      ensureBenchmarkDatasets();
      const datasets = ['small', 'medium', 'large', 'nearMax'];
      const results: Array<Record<string, unknown>> = [];

      for (const dataset of datasets) {
        const beforeMem = memorySnapshot();
        const { entries, readMs } = readDataset(dataset);

        const parseStarted = performance.now();
        const fileDurations: number[] = [];
        let lastDoneFiles = 0;
        let lastTime = parseStarted;
        let firstGraphMs: number | null = null;
        const parsed = await parseRenpyFiles(entries, {
          onProgress: ({ doneFiles }) => {
            const now = performance.now();
            if (doneFiles > lastDoneFiles) {
              fileDurations.push(now - lastTime);
              lastTime = now;
              lastDoneFiles = doneFiles;
              if (firstGraphMs === null) {
                firstGraphMs = now - parseStarted;
              }
            }
          },
        });
        const parseMs = performance.now() - parseStarted;

        const layoutStarted = performance.now();
        const { nodes, edges } = applyDagreLayout(parsed.nodes, parsed.edges, 'TB');
        const layoutMs = performance.now() - layoutStarted;

        const renderStarted = performance.now();
        const visibleNodes = buildVisibleNodes({
          nodes,
          search: '',
          minDialogue: 0,
          collapsedChapters: {},
          collapsedLabelChildren: new Set(),
          theme: 'violet',
        });
        const visibleNodeIds = new Set(visibleNodes.filter((n) => !n.hidden).map((n) => n.id));
        const visibleEdges = buildVisibleEdges({
          edges,
          showCallReturns: true,
          visibleEdgeKinds: { sequence: true, jump: true, call: true, call_return: true },
          visibleNodeIds,
          edgeColor: '#4b5563',
          largeGraphMode: parsed.nodes.length > 180 || parsed.edges.length > 320,
        });
        const renderTransformMs = performance.now() - renderStarted;

        const exportEstimateStarted = performance.now();
        const exportPayloadBytesEstimate = JSON.stringify({ nodes: visibleNodes, edges: visibleEdges }).length;
        const exportEstimateMs = performance.now() - exportEstimateStarted;

        const afterMem = memorySnapshot();
        results.push({
          dataset,
          files: entries.length,
          nodes: parsed.nodes.length,
          edges: parsed.edges.length,
          readMs: Number(readMs.toFixed(2)),
          parseMs: Number(parseMs.toFixed(2)),
          firstGraphMs: Number((firstGraphMs ?? parseMs).toFixed(2)),
          parsePerFileAvgMs: Number(
            (
              fileDurations.reduce((sum, ms) => sum + ms, 0) / Math.max(fileDurations.length, 1)
            ).toFixed(2),
          ),
          layoutMs: Number(layoutMs.toFixed(2)),
          renderTransformMs: Number(renderTransformMs.toFixed(2)),
          exportEstimateMs: Number(exportEstimateMs.toFixed(2)),
          exportPayloadBytesEstimate,
          memoryBefore: beforeMem,
          memoryAfter: afterMem,
        });
      }

      mkdirSync(perfDataDir, { recursive: true });
      writeFileSync(
        outPath,
        JSON.stringify({ results }, null, 2),
        'utf8',
      );

      expect(results).toHaveLength(4);
      expect(results.every((result) => Number(result.parseMs) > 0)).toBe(true);
    },
    60_000,
  );
});
