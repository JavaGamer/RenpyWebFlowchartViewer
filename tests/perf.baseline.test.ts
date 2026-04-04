import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { parseRenpyFiles } from '../src/parser';
import { applyDagreLayout, buildVisibleNodes, buildVisibleEdges } from '../src/flowchartTransforms';

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(thisDir, '..');
const perfDataDir = path.join(repoRoot, 'perf-data');
const outPath = path.join(perfDataDir, 'baseline-results.json');

function memorySnapshot() {
  const m = process.memoryUsage();
  return {
    rssMB: Number((m.rss / (1024 * 1024)).toFixed(2)),
    heapUsedMB: Number((m.heapUsed / (1024 * 1024)).toFixed(2)),
    heapTotalMB: Number((m.heapTotal / (1024 * 1024)).toFixed(2)),
  };
}

function readDataset(datasetName: string) {
  const dir = path.join(perfDataDir, datasetName);
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
      const datasets = ['small', 'medium', 'large'];
      const results: Array<Record<string, unknown>> = [];

      for (const dataset of datasets) {
        const beforeMem = memorySnapshot();
        const { entries, readMs } = readDataset(dataset);

        const parseStarted = performance.now();
        const fileDurations: number[] = [];
        let lastDoneFiles = 0;
        let lastTime = parseStarted;
        const parsed = await parseRenpyFiles(entries, {
          onProgress: ({ doneFiles }) => {
            const now = performance.now();
            if (doneFiles > lastDoneFiles) {
              fileDurations.push(now - lastTime);
              lastTime = now;
              lastDoneFiles = doneFiles;
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
        JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2),
        'utf8',
      );

      expect(results).toHaveLength(3);
      expect(results.every((result) => Number(result.parseMs) > 0)).toBe(true);
    },
    60_000,
  );
});
