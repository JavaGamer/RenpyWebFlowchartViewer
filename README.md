# Ren'Py Web Flowchart Viewer

A client-side web application that parses Ren'Py script files (`.rpy`) and
generates an interactive flowchart of the game's major structural events.

## Features

- **100% local processing** — files are read entirely in the browser via the
  FileReader API; nothing is uploaded to a server.
- **Automatic structure extraction** — detects `label` blocks, `menu` choices,
  `jump`/`call` statements, direct `renpy.jump`/`renpy.call` in label-scoped
  Python blocks, direct screen `action Jump(...)`/`action Call(...)` in
  label-scoped screen blocks, timer-driven `timer ... action ...` timeout
  branches, and counts dialogue lines per block.
- **Conservative same-label target propagation** — resolves identifier targets
  for `jump expression`, direct `renpy.jump`/`renpy.call`, and screen action
  calls when a prior assignment in the same label binds that identifier to a
  static string literal (including typed forms like `name: str = "label"`).
- **Variant-aware parser rules** — choose `Ren'Py` or `ST` parser variants, with
  variant defaults plus custom screen-action mappings persisted in browser
  storage across imports/projects.
- **Interactive flowchart** — drag, zoom, and pan the chart using React Flow.
  Nodes are colour-coded: violet for Labels, amber for Menus, teal for Decisions
  (`if/elif/else` split points).
- **Filtering and subgraph controls** — search labels/dialogue, filter by
  minimum dialogue lines, and use progressive disclosure to reveal advanced
  chapter/label subgraph controls (including collapse-all / expand-all).
- **Dialogue inspector workflow** — search dialogue lines, open matching results
  directly, inspect node dialogue in a side panel, and expand beyond the default
  20-line preview.
- **Large-project optimization controls** — dialogue search mode can be set to
  full indexing or performance mode (label/count search only), with auto mode
  favoring faster first graph for near-max imports.
- **Layout and navigation controls** — switch auto-layout direction, re-run
  layout, drag nodes manually, apply zoom presets, and use the minimap.
- **Themes and accessibility** — choose default, high-contrast, or
  colorblind-safe color palettes.
- **Keyboard accessibility** — focus-visible controls, skip link support, and
  shortcut hints for common actions.
- **Edge labels** — menu-option text and call annotations are shown on the
  connecting arrows.
- **Conditional path simulation** — conditional branches retain expression
  metadata and can be simulated with mock flag values; unreachable branches can
  be faded or hidden.
- **Export options** — export the current chart as PNG or SVG, and optionally
  download the raw graph as JSON.
- **Privacy-aware debugging/reporting** — export a debug bundle and open a
  prefilled GitHub bug report, with file names and raw/script details excluded
  by default unless you explicitly opt in.
- **Responsive UI** — toolbar, canvas, and inspector adapt for desktop, tablet,
  and mobile widths.
- **Upload status guidance** — onboarding includes explicit import steps,
  state-specific read/parse status text, and clear retry/start-over actions on
  failure.
- **Progressive control hierarchy** — primary controls stay visible for common
  tasks, while advanced graph controls are available on demand.

## Usage

1. Open the app in your browser (see [Running Locally](#running-locally) below).
2. Click the upload zone or drag a folder onto it.
3. Select the folder that contains your Ren'Py `.rpy` scripts (e.g. the `game/`
   directory of a project).
4. The flowchart is generated automatically.
5. Optional: choose a parser variant and add custom screen-action rules before
   import; settings persist across projects in your browser.
6. Use **Export PNG** or **Export SVG** to save the chart as an image, or
   **Export JSON** to download graph data.
7. Use **Export Debug Bundle** to download a troubleshooting JSON bundle; file
   names and raw/script details are opt-in and off by default.
8. Use **Open new GitHub issue** to open a prefilled bug report draft and attach
   your debug bundle manually if desired.
9. If import fails, use **Try again** in the error panel to reopen folder
   selection immediately (or **Start over** to reset the upload state).
10. Label subgraph collapse state resets on each new import to avoid stale state
    from previous uploads.

## Interaction Model

- **Primary controls (always visible)**: search, minimum dialogue filter, fit
  view, export actions, zoom presets, and keyboard shortcut hints.
- **Search mode selector (always visible)**: choose `Auto`,
  `Full dialogue line search`, or `Performance mode` depending on import size
  and responsiveness needs.
- **Advanced controls (on demand)**: layout direction, theme, focus-label
  centering, large-graph mode controls, edge-kind toggles, chapter collapse, and
  label subgraph tools.
- **Mock state panel (advanced controls)**:
  - discovered condition flags are listed with `unknown` / `true` / `false`
    toggles
  - unsupported or dynamic conditions remain `unknown` and are never
    force-hidden
  - unreachable conditional branches can be either faded (default) or hidden
- **Inspector model**:
  - shows both node-level match count and dialogue-line results while searching
  - supports keyboard result navigation (`↑` / `↓`) and open (`Enter`)
  - keeps selected-node and selected-line context visible in the dialogue panel

## UX Goals and Success Metrics

Priorities:

- Faster first-use comprehension
- Lower interaction friction
- Better discoverability of controls
- Stronger accessibility
- Clearer error recovery

Track outcomes with:

- upload success rate
- time-to-first-graph
- time-to-find-node
- export completion rate
- keyboard-only task completion rate
- mobile usability pass rate

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
npm run bench:perf    # run opt-in perf baseline benchmark and write perf-data/baseline-results.json
```

Coverage thresholds are enforced for parser-critical files in CI.

## Search + Inspector UX (Polish Release Criteria)

This release is considered done when all of the following are true:

- Parser capture of dialogue lines is present on node data.
- Search matches labels, dialogue count, and dialogue line content.
- Dialogue match results can be selected to focus and inspect the owning node.
- Inspector shows dialogue lines with default truncation at 20 lines, with show
  more/less toggle.
- Search terms are visually highlighted in both results and inspector dialogue
  lines.
- Keyboard navigation is supported for results from the search input:
  - `↑` / `↓` moves active result
  - `Enter` opens active result in inspector
- Control areas are grouped and labeled for assistive technology:
  - viewer controls
  - search and filters
  - layout and focus controls
  - export controls
- Empty and zero-result states provide clear guidance text.

### Interaction shortcuts

- `Ctrl/Cmd + F` — focus search input
- `Ctrl/Cmd + L` — fit graph to view
- `Ctrl/Cmd + E` — export PNG

## Browser and Device Support

- Designed for modern Chromium, Firefox, and Safari browsers.
- Folder upload uses the widely supported `webkitdirectory`/`directory`
  attributes where available.
- If browser support for folder attributes is limited, select files manually in
  the file picker.
- Layout and inspector behavior are optimized for desktop, tablet, and mobile
  viewports.

### Follow-up ideas (out of scope for this release)

- Advanced search filters (type/scoped matching)
- Pinning or multi-node inspector views
- Additional result grouping/sorting controls

## Performance Benchmarking

- Benchmark datasets are stored in:
  - `perf-data/generated/small`
  - `perf-data/generated/medium`
  - `perf-data/generated/large`
  - generated automatically by the benchmark test
- Run `npm run bench:perf` to measure:
  - file-read timing
  - parser total timing and per-file average
  - layout timing
  - render transform timing
  - export payload estimate timing
  - memory snapshots before/after each dataset run
- Results are written to:
  - `perf-data/baseline-results.json`
- For in-browser phase timing logs, enable debug perf logging:
  - `localStorage.setItem('rfv.debugPerf', 'true')`
  - or set `globalThis.__RFV_DEBUG_PERF__ = true` in dev tools

### Baseline / Before-After Table

After running `npm run bench:perf`, summarize key metrics from
`perf-data/baseline-results.json`:

| Dataset | Read (ms) | Parse total (ms) | Parse/file avg (ms) | Layout (ms) | Render transform (ms) | Export estimate (ms) | Nodes | Edges | Memory after (heap MB) |
| ------- | --------: | ---------------: | ------------------: | ----------: | --------------------: | -------------------: | ----: | ----: | ---------------------: |
| small   |      0.09 |            40.25 |                9.61 |       33.87 |                  0.45 |                 0.27 |   108 |    72 |                  19.64 |
| medium  |      0.29 |           150.04 |                8.16 |      302.37 |                  0.96 |                 1.45 |   846 |   612 |                  34.08 |
| large   |      0.77 |            687.8 |               11.12 |     3540.73 |                  5.51 |                 8.46 |  4500 |  3600 |                  75.31 |
| nearMax |      6.72 |          1008.15 |                3.74 |    24144.57 |                 14.19 |                13.25 |  8580 |  6240 |                 199.34 |

## Troubleshooting

- **`npm install` or `npm ci` shows `@renpy/ast` engine warnings**\
  The package currently declares `node: ^23`. The project still works in current
  local/CI setups, but matching the CI runtime (Node 20+) is recommended for
  consistency.

- **Upload appears to do nothing**\
  The parser only processes files with a `.rpy` extension. Ensure your selected
  folder contains Ren'Py script files named with `.rpy`.

- **Importing compiled games (.rpyc files) or archives (.rpa files)**\
  The Flowchart Viewer requires plain-text `.rpy` source files. If you only have
  `.rpyc` files (compiled bytecode) or `.rpa` archives (compressed game assets),
  you must first extract and decompile them locally:
  1. Extract `.rpa` files using a tool like
     [unrpa](https://github.com/Lattyware/unrpa) or
     [rpatool](https://codeberg.org/shiz/rpatool).
  2. Decompile `.rpyc` files back to `.rpy` using
     [unrpyc](https://github.com/CensoredUsername/unrpyc).
  3. Upload the resulting folder of decompiled `.rpy` files to the viewer.

- **Flowchart is empty after upload**\
  This can happen when scripts contain no parsable `label` or `menu` structures
  (for example, comment-only files). Try with a script that includes at least
  one `label`.

- **Tests behave inconsistently while iterating locally**\
  `@renpy/ast` uses module-level tokenizer state. Run tests in a clean process
  (`npm run test`) after changes instead of reusing stale watch state.

- **Large uploads feel slow or heavy**\
  Parsing runs in a Web Worker with progress updates and cancel support.
  Near-max uploads now process in bounded batches and progressively update the
  graph so first graph appears sooner. In `Auto` dialogue mode, large imports
  may use performance search mode (label/count only); switch to `Full` to force
  dialogue line indexing.

## Docker

A multi-stage Dockerfile is provided that builds the app with Node.js and serves
it with Nginx:

```bash
docker build -t renpy-flowchart-viewer .
docker run -p 8080:80 renpy-flowchart-viewer
```

Then open <http://localhost:8080>.

## Parser Architecture and Conventions

- The parser is split into focused phases:
  - token scanning per file
  - graph assembly (nodes/edges + dedupe)
  - graph normalization/validation (invariant repair + structured warnings)
  - strict role classification
- Token and meta IDs come from `@renpy/ast` enums via `src/parserTokens.ts` with
  runtime validation guards, instead of hardcoded numeric literals.
- Current tokenizer quirk: Ren'Py `menu` may be observed as
  `KeywordTokenType.Def`; this is guarded and validated at startup.
- Worker message exchange uses a versioned protocol contract in
  `src/infrastructure/workerProtocol.ts`.

### Parser correctness goals and failure taxonomy

- **Extraction misses**: expected labels/menus/jump/call/action targets not
  emitted.
- **False-positive edges**: edges emitted from comments/strings/non-action
  contexts.
- **Control-flow misclassification**: incorrect fallthrough suppression around
  conditional/menu/return/jump/call.
- **Conditional branch fidelity**: `if/elif/else` should materialize as explicit
  decision nodes with conditioned outgoing edges.
- **Unresolved-target handling**: unresolved jump/call targets remain in graph
  with explicit warning signals.
- **Render-time inaccuracies**: visibility/layout drops or unstable ordering for
  valid parser output.

Ambiguous constructs policy:

- dynamic python/screen targets remain static-only: no inferred edge, emit
  warning
- same-label identifier propagation is conservative and local: only earlier
  same-label literal assignments are used, latest assignment wins, and
  non-literal reassignments clear the tracked binding
- top-level python/screen blocks are treated as global definitions and are not
  back-attributed to the previously parsed label
- malformed scripts are best-effort parsed: recover parsable labels/edges
  without throwing
- unresolved targets emit parser warnings and are preserved for downstream
  handling
- nested/conditional menus preserve branch edges while avoiding unconditional
  fallthrough suppression
- conditional expressions are evaluated conservatively in viewer simulation
  (`true` / `false` / `unknown`); unsupported expressions remain `unknown`
- when available, uploaded relative paths are preserved for deterministic
  chapter naming and duplicate-basename imports

## Application Architecture

- **Domain layer** (`src/domain`): graph model and shared domain-level types.
- **Application layer** (`src/application`): orchestration logic (upload
  validation, app reducer, parse service, error policy).
- **Infrastructure layer** (`src/infrastructure`): runtime adapters (file
  reading, parser worker client, worker protocol contract).
- **UI layer** (`src/*.tsx`, `src/flowchartTransforms.ts`, `src/ui`): React
  rendering and interaction logic.

### Layer entrypoints

Cross-layer imports are routed through canonical public entrypoints:

- `src/domain/index.ts`
- `src/application/index.ts`
- `src/infrastructure/index.ts`
- `src/ui/index.ts`

#### Migration notes

- `src/parseInWorker.ts` was removed.
- Import `parseRenpyFilesInWorker` from `src/infrastructure` instead.

See `docs/architecture.md` for the detailed architecture and flow.

### Duplicate labels across files

- Label node IDs are deduplicated by label name.
- The first-seen node metadata is retained (`chapter`, initial label metadata),
  while dialogue counts and edges from subsequent files continue to aggregate
  into the same logical node.

### Unresolved jump/call targets

- Jump/call edges are emitted even when a target label is not defined in the
  uploaded set.
- For direct Python/screen API forms (and `jump expression`), literal-string
  targets are emitted as edges. Identifier targets are also resolved when an
  earlier assignment in the same label maps the identifier to a literal;
  otherwise dynamic targets are reported as parser warnings in the parse result.
- Parser warnings are shown in a warning panel above the graph when present.
- Parser variants:
  - `renpy`: default `Jump`/`Call` screen-action extraction.
  - `st`: includes additional default screen-action mappings (`timedchoice`,
    `gameover`, `title`, `placeholder`, `routename`).
- Custom screen-action rules are persisted per variant in local storage
  (`rfv.parser.settings`), so creator-defined mappings persist across project
  imports.
- The viewer filters out edges whose source/target nodes are missing from the
  final node set.
- This preserves parser fidelity while keeping rendering stable.

## Contributing

Please read the contributor guide before opening a pull request:
[CONTRIBUTING.md](./CONTRIBUTING.md).

## Technology Stack

| Concern    | Library                                                 |
| ---------- | ------------------------------------------------------- |
| Framework  | React 19 + Vite 8 (TypeScript)                          |
| Styling    | Tailwind CSS 4                                          |
| Parser     | @renpy/ast (official Ren'Py VSCode extension tokenizer) |
| Graph UI   | @xyflow/react (React Flow)                              |
| Layout     | @dagrejs/dagre                                          |
| Export     | html-to-image                                           |
| Deployment | Docker (Node 24 build → nginx:1.27 runtime)             |
