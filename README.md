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
```

## Troubleshooting

- **`npm install` or `npm ci` shows `@renpy/ast` engine warnings**  
  The package currently declares `node: ^23`. The project still works in current local/CI setups, but matching the CI runtime (Node 20+) is recommended for consistency.

- **Upload appears to do nothing**  
  The parser only processes files with a `.rpy` extension. Ensure your selected folder contains Ren'Py script files named with `.rpy`.

- **Flowchart is empty after upload**  
  This can happen when scripts contain no parsable `label` or `menu` structures (for example, comment-only files). Try with a script that includes at least one `label`.

- **Tests behave inconsistently while iterating locally**  
  `@renpy/ast` uses module-level tokenizer state. Run tests in a clean process (`npm run test`) after changes instead of reusing stale watch state.

## Docker

A multi-stage Dockerfile is provided that builds the app with Node.js and serves it with Nginx:

```bash
docker build -t renpy-flowchart-viewer .
docker run -p 8080:80 renpy-flowchart-viewer
```

Then open <http://localhost:8080>.

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
