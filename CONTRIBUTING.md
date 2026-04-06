# Contributing to Ren'Py Web Flowchart Viewer

Thanks for your interest in contributing.

## Prerequisites

- Node.js 20+ (CI runs on Node 20)
- npm

## Local Setup

```bash
npm install
npm run dev
```

Open <http://localhost:5173>.

## Build, Lint, and Test

Run these before opening a PR:

```bash
npm run lint
npm run build
npm run test
```

Optional coverage run:

```bash
npm run test:coverage
```

Optional perf baseline run:

```bash
npm run bench:perf
```

## Troubleshooting During Development

- `@renpy/ast` can keep module-level tokenizer cache between test runs. If test behavior looks stale, rerun `npm run test` in a clean process.
- Parsing is extension-based: only `.rpy` files are considered input.
- A flowchart may be empty if uploaded files contain no parsable `label` or `menu` nodes.

## Pull Request Process

1. Create a branch from the latest default branch.
2. Make focused changes with clear commit messages.
3. Ensure `npm run lint`, `npm run build`, and `npm run test` pass locally.
4. Open a pull request describing:
   - What changed
   - Why it changed
   - Any testing performed
   - How architectural boundaries were preserved (domain/application/infrastructure/ui)
   - Whether cross-layer imports were kept on layer entrypoints (`src/domain`, `src/application`, `src/infrastructure`, `src/ui`)
5. Address CI or review feedback and keep the PR scope focused.

## UI/UX + Accessibility Checklist

For UI-facing changes, verify:

- Responsive behavior on representative widths (mobile, tablet, desktop).
- Keyboard navigation for controls and search workflows.
- Focus-visible styles on interactive controls remain clear.
- ARIA labels and semantic structure are preserved for key regions.
- Viewer control landmarks/groups remain present (`Viewer controls`, `Search and filters`, `Layout and focus controls`, `Export controls`).
- Contrast remains acceptable in default, high-contrast, and colorblind-safe themes.
- Upload flow feedback remains clear across idle, reading, parsing, error, and empty-result states.
