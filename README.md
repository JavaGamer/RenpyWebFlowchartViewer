# Ren'Py Web Flowchart Viewer

A client-side web application that parses Ren'Py script files (`.rpy`) and generates an interactive flowchart of the game's major structural events.

## Features

- **100% local processing** — files are read entirely in the browser via the FileReader API; nothing is uploaded to a server.
- **Automatic structure extraction** — detects `label` blocks, `menu` choices, `jump`/`call` statements, and counts dialogue lines per block.
- **Interactive flowchart** — drag, zoom, and pan the chart using React Flow. Nodes are colour-coded: violet for Labels, amber for Menus.
- **Filtering and subgraph controls** — search labels/dialogue, filter by minimum dialogue lines, and collapse graph sections by chapter or parent label.
- **Layout and navigation controls** — switch auto-layout direction, re-run layout, drag nodes manually, apply zoom presets, and use the minimap.
- **Themes and accessibility** — choose default, high-contrast, or colorblind-safe color palettes.
- **Edge labels** — menu-option text and call annotations are shown on the connecting arrows.
- **Export options** — export the current chart as PNG or SVG, and optionally download the raw graph as JSON.

## Usage

1. Open the app in your browser (see [Running Locally](#running-locally) below).
2. Click the upload zone or drag a folder onto it.
3. Select the folder that contains your Ren'Py `.rpy` scripts (e.g. the `game/` directory of a project).
4. The flowchart is generated automatically.
5. Use **Export PNG** or **Export SVG** to save the chart as an image, or **Export JSON** to download graph data.

## Running Locally

```bash
npm install
npm run dev
```

Then open <http://localhost:5173> in your browser.

## Building for Production

```bash
npm run build        # outputs to dist/
npm run preview      # serve the built app locally
```

## Testing

```bash
npm run test          # run parser unit tests
npm run test:coverage # run tests with coverage report
npm run bench:perf    # run perf baseline benchmark and write perf-data/baseline-results.json
```

Coverage thresholds are enforced for parser-critical files in CI.

## Performance Benchmarking

- Benchmark datasets are stored in:
  - `/home/runner/work/RenpyWebFlowchartViewer/RenpyWebFlowchartViewer/perf-data/small`
  - `/home/runner/work/RenpyWebFlowchartViewer/RenpyWebFlowchartViewer/perf-data/medium`
  - `/home/runner/work/RenpyWebFlowchartViewer/RenpyWebFlowchartViewer/perf-data/large`
- Run `npm run bench:perf` to measure:
  - file-read timing
  - parser total timing and per-file average
  - layout timing
  - render transform timing
  - export payload estimate timing
  - memory snapshots before/after each dataset run
- Results are written to:
  - `/home/runner/work/RenpyWebFlowchartViewer/RenpyWebFlowchartViewer/perf-data/baseline-results.json`
- For in-browser phase timing logs, enable debug perf logging:
  - `localStorage.setItem('rfv.debugPerf', 'true')`
  - or set `globalThis.__RFV_DEBUG_PERF__ = true` in dev tools

### Baseline / Before-After Table

After running `npm run bench:perf`, summarize key metrics from `perf-data/baseline-results.json`:

| Dataset | Read (ms) | Parse total (ms) | Parse/file avg (ms) | Layout (ms) | Render transform (ms) | Export estimate (ms) | Nodes | Edges | Memory after (heap MB) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| small | _fill from JSON_ | _fill from JSON_ | _fill from JSON_ | _fill from JSON_ | _fill from JSON_ | _fill from JSON_ | _fill_ | _fill_ | _fill_ |
| medium | _fill from JSON_ | _fill from JSON_ | _fill from JSON_ | _fill from JSON_ | _fill from JSON_ | _fill from JSON_ | _fill_ | _fill_ | _fill_ |
| large | _fill from JSON_ | _fill from JSON_ | _fill from JSON_ | _fill from JSON_ | _fill from JSON_ | _fill from JSON_ | _fill_ | _fill_ | _fill_ |

## Troubleshooting

- **`npm install` or `npm ci` shows `@renpy/ast` engine warnings**  
  The package currently declares `node: ^23`. The project still works in current local/CI setups, but matching the CI runtime (Node 20+) is recommended for consistency.

- **Upload appears to do nothing**  
  The parser only processes files with a `.rpy` extension. Ensure your selected folder contains Ren'Py script files named with `.rpy`.

- **Flowchart is empty after upload**  
  This can happen when scripts contain no parsable `label` or `menu` structures (for example, comment-only files). Try with a script that includes at least one `label`.

- **Tests behave inconsistently while iterating locally**  
  `@renpy/ast` uses module-level tokenizer state. Run tests in a clean process (`npm run test`) after changes instead of reusing stale watch state.

- **Large uploads feel slow or heavy**  
  Parsing runs in a Web Worker with progress updates and cancel support. If you hit upload limits (file count or total size), split uploads into smaller batches.

## Docker

A multi-stage Dockerfile is provided that builds the app with Node.js and serves it with Nginx:

```bash
docker build -t renpy-flowchart-viewer .
docker run -p 8080:80 renpy-flowchart-viewer
```

Then open <http://localhost:8080>.



## Parser Architecture and Conventions

- The parser is split into focused phases:
  - token scanning per file
  - graph assembly (nodes/edges + dedupe)
  - strict role classification
- Token and meta IDs come from `@renpy/ast` enums via `src/parserTokens.ts` with runtime validation guards, instead of hardcoded numeric literals.
- Current tokenizer quirk: Ren'Py `menu` may be observed as `KeywordTokenType.Def`; this is guarded and validated at startup.

### Duplicate labels across files

- Label node IDs are deduplicated by label name.
- The first-seen node metadata is retained (`chapter`, initial label metadata), while dialogue counts and edges from subsequent files continue to aggregate into the same logical node.

### Unresolved jump/call targets

- Jump/call edges are emitted even when a target label is not defined in the uploaded set.
- The viewer filters out edges whose source/target nodes are missing from the final node set.
- This preserves parser fidelity while keeping rendering stable.

## Contributing

Please read the contributor guide before opening a pull request: [CONTRIBUTING.md](./CONTRIBUTING.md).

## Technology Stack

| Concern | Library |
|---|---|
| Framework | React 19 + Vite 8 (TypeScript) |
| Styling | Tailwind CSS 4 |
| Parser | @renpy/ast (official Ren'Py VSCode extension tokenizer) |
| Graph UI | @xyflow/react (React Flow) |
| Layout | @dagrejs/dagre |
| Export | html-to-image |
| Deployment | Docker (Node 24 build → nginx:1.27 runtime) |
