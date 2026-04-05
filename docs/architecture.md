# Architecture Overview

This project is organized into layered modules to keep parser correctness, UI responsiveness, and maintainability balanced.

## Layers

- **Domain (`src/domain`)**
  - Core graph model and shared domain types.
  - No browser or framework dependencies.

- **Application (`src/application`)**
  - Use-case orchestration and policy logic.
  - Examples: upload validation, app reducer/state transitions, parse service abstraction, user-facing error mapping.

- **Infrastructure (`src/infrastructure`)**
  - Adapters for browser/runtime boundaries.
  - Examples: file reader wrapper, worker protocol contract.

- **UI (`src/*.tsx`, `src/flowchartTransforms.ts`)**
  - React components and rendering concerns.
  - Uses application and domain abstractions instead of low-level runtime details directly.

## Parser and Worker Lifecycle

- `parser.ts` remains the parser API surface (`parseRenpyFiles`) and output contract (`FlowNode[]`, `FlowEdge[]`).
- `parseInWorker.ts` and `parserWorker.ts` use a versioned protocol (`src/infrastructure/workerProtocol.ts`) to exchange parse/cancel/progress/result/error messages.
- Cancellation and stale response handling are request-id scoped.

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
