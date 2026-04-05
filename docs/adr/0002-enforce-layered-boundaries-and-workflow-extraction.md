# ADR 0002: Enforce Layered Boundaries and Extract Upload Workflow

## Status

Accepted

## Context

After introducing layered boundaries (ADR 0001), key modules still had soft coupling:

- parser worker client behavior was exposed from a top-level module path
- `App.tsx` retained the full upload/read/parse orchestration lifecycle
- UI presentation concerns were co-located in a single large viewer component
- legacy shared type entrypoint usage (`src/types.ts`) remained possible

## Decision

- Place worker client orchestration under infrastructure (`src/infrastructure/parserWorkerClient.ts`) and keep protocol contracts in infrastructure.
- Extract the upload/read/parse lifecycle into an application workflow module (`src/application/processUpload.ts`).
- Split viewer presentation concerns into focused UI modules (`src/ui/viewerTheme.ts`, `src/ui/viewerNodes.tsx`, `src/ui/viewerEdges.tsx`).
- Remove legacy `src/types.ts` entrypoint usage and import graph contracts from `src/domain/graph`.
- Enforce lightweight import guardrails via eslint restricted-import rules.
- Add architecture boundary tests to verify key layer direction constraints.

## Consequences

- Layer boundaries become explicit and testable.
- `App.tsx` is reduced to composition and intent wiring.
- Infrastructure concerns are isolated from UI and application internals.
- Refactoring risk is lowered by executable guardrails in lint/tests.
