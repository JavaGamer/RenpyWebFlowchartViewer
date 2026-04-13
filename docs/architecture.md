# Architecture Overview

This project is organized into layered modules to keep parser correctness, UI responsiveness, and maintainability balanced.

## Layers

- **Domain (`src/domain`)**
  - Core graph model and shared domain types.
  - No browser or framework dependencies.

- **Application (`src/application`)**
  - Use-case orchestration and policy logic.
  - Examples: upload validation, app reducer/state transitions, parse service abstraction, upload→read→parse workflow, user-facing error mapping.

- **Infrastructure (`src/infrastructure`)**
  - Adapters for browser/runtime boundaries.
  - Examples: file reader wrapper, parser worker client wrapper, worker protocol contract.

- **UI (`src/*.tsx`, `src/flowchartTransforms.ts`, `src/ui`)**
  - React components and rendering concerns.
  - Uses application and domain abstractions instead of low-level runtime details directly.

## Parser and Worker Lifecycle

- `parser.ts` remains the parser API surface (`parseRenpyFiles`) and output contract (`FlowNode[]`, `FlowEdge[]`).
- Parser finalization includes graph normalization/validation before role classification:
  - edge-kind normalization
  - semantic edge deduplication
  - unresolved-target warning emission
  - invariant repair for malformed/missing endpoints
- `src/infrastructure/parserWorkerClient.ts` and `parserWorker.ts` use a versioned protocol (`src/infrastructure/workerProtocol.ts`) to exchange parse/cancel/progress/result/error messages.
- Cancellation and stale response handling are request-id scoped.

## Enforced Dependency Direction

- `domain` → no dependencies on application/infrastructure/ui
- `application` → may depend on domain + infrastructure contracts
- `infrastructure` → may depend on domain, but not on application/ui
- `ui` → may depend on application/domain/config/ui helpers
- parser pipeline modules (`src/parser`) → may depend on domain/parser modules, not ui

## Configuration and Persistence

- Upload limits are centralized in `src/config/uploadLimits.ts`.
- Viewer thresholds and tuning are centralized in `src/config/viewerConfig.ts`.
- Local storage keys are centralized in `src/config/storageKeys.ts`.

## Testing Strategy

- Existing parser and UI integration tests remain the regression safety net.
- Boundary-focused tests were added for:
  - upload validation (`tests/uploadValidation.test.ts`)
  - app state transitions (`tests/appState.test.ts`)
  - worker protocol versioning behavior (`tests/parseInWorker.test.ts`)

## UI Interaction Architecture (Progressive Disclosure)

- `src/FlowchartViewer.tsx` keeps interaction hierarchy in the UI layer:
  - **Primary controls** are always visible for high-frequency tasks (search/filter baseline, fit, zoom, export).
  - **Advanced controls** are revealed on demand for lower-frequency tasks (layout/theme/focus/edge toggles/subgraph controls).
- `src/flowchartTransforms.ts` remains responsible for graph visibility and transformation decisions (search filtering, edge filtering, large-graph edge-label behavior).
- `src/flowchartTransforms.ts` also enforces pre-render graph integrity policy:
  - deterministic edge dedupe/kind normalization
  - placeholder node materialization for unresolved edge endpoints
  - deterministic ordering/fallback placement for large progressive layouts
- `src/ui/viewerTheme.ts` remains the source of theme tokens, while interactive control styling is standardized at component level using shared class constants.

## UX and Accessibility Conventions

- Upload flow states (`idle`, `reading`, `parsing`, `done`, `error`) should include explicit user-facing status guidance and next-step actions.
- Error/empty states should provide concrete remediation guidance and a clear retry path.
- Toolbar and inspector status text should use live-region semantics where changes are user-relevant.
- Keyboard interaction should preserve:
  - global shortcuts (`Ctrl/Cmd+F`, `Ctrl/Cmd+L`, `Ctrl/Cmd+E`)
  - search-result navigation (`↑`, `↓`, `Enter`)
  - visible focus affordances across controls.

## UX Rollout Plan (Staged)

- **Stage 1**: copy/status clarity, empty/error guidance, retry affordances, visual consistency quick wins.
- **Stage 2**: control hierarchy restructuring and responsive layout improvements.
- **Stage 3**: accessibility hardening and performance-perception polish.
- **Stage 4**: documentation alignment and follow-up UX refinements.
