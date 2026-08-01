# Project: RenpyWebFlowchartViewer Audit & Refactor

## Architecture

- `src/parser`: Ren'Py script lexer, AST parser, statement transformers.
- `src/domain`: Domain models, AST nodes, flowchart node/edge structures.
- `src/application`: Application services, layout coordination, state stores
  (Zustand/Immer).
- `src/infrastructure`: Web worker, Comlink wrapper, ELK layout calculation
  integration.
- `src/ui`: React Flow components, controls, node types, edge types, theme
  context.

## Code Layout

- Mandated toolchain: Deno (`deno task test`, `deno task build`,
  `deno task lint`, `deno fmt --check`, `deno task bench:perf`).

## Milestones

| # | Name                              | Scope                                      | Dependencies | Status      |
| - | --------------------------------- | ------------------------------------------ | ------------ | ----------- |
| 1 | Baseline Diagnostic & Exploration | Run deno test, lint, build, fmt, bench     | none         | DONE        |
| 2 | Parser & AST Fixes                | Parser, lexer, AST node transformation     | M1           | IN_PROGRESS |
| 3 | Layout Engine & State Store Fixes | Web worker, Comlink, Zustand/Immer, ELK    | M1           | PLANNED     |
| 4 | UI & Component Fixes              | React Flow node/edge components, App UI    | M2, M3       | PLANNED     |
| 5 | Code Quality & Verification Sweep | Type check, lint, format check, perf bench | M2, M3, M4   | PLANNED     |
| 6 | E2E Suite & Forensic Audit        | Full verification & integrity check        | M5           | PLANNED     |

## Interface Contracts

- Worker API: Comlink interface for layout calculation (`layoutWorker.ts`).
- Store API: Zustand store for flowchart state, script loading, node selection.
