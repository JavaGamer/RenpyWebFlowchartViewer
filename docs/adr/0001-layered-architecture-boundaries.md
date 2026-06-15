# ADR 0001: Introduce Layered Architecture Boundaries

## Status

Accepted

## Context

`App.tsx`, `FlowchartViewer.tsx`, and parser/worker files had mixed concerns
(domain, orchestration, browser adapters, and UI), making targeted changes
riskier.

## Decision

Adopt explicit boundaries:

- Domain types in `src/domain`
- Use-case/policy modules in `src/application`
- Runtime adapters and protocol contracts in `src/infrastructure`
- UI composition in React components

Also define a versioned worker message contract.

## Consequences

- Better separation of concerns and testability.
- Lower coupling between UI and low-level runtime details.
- Easier incremental refactoring without changing public behavior.
