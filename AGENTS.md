# Agent Rules & Execution Guidelines

## Toolchain & Command Rule

- **Always use Deno** instead of `npm` or `node` for all tasks, package
  management, testing, linting, formatting, and building in this repository.
- Use `deno task test` instead of `npm test` or `npm run test`.
- Use `deno task build` instead of `npm run build`.
- Use `deno task lint` instead of `npm run lint`.
- Use `deno fmt` or `deno fmt --check` for formatting instead of
  `npm run format`.
- Use `deno task bench:perf` for performance benchmarks.
- Use `deno run` or `deno task` for running any script or execution.
