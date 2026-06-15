/**
 * Minimal type declarations for the internal @renpy/ast tokenizer module.
 *
 * The @renpy/ast package does not export its Tokenizer class from its public
 * API, but we need to call `Tokenizer.clearTokenCache()` between tests to
 * prevent the static document-level cache (keyed on the fixed URI
 * "file://my.rpy" / version 0 used by `parse()`) from returning stale tokens
 * when multiple test cases are run in the same module context.
 */
declare module "@renpy/ast/out/tokenizer/tokenizer" {
  export class Tokenizer {
    /** Clears the static per-document token cache. */
    static clearTokenCache(): void;
  }
}
