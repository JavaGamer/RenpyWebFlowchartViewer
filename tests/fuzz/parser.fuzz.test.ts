import { beforeEach, describe, expect, it } from "vitest";
import fc from "fast-check";
import { Tokenizer } from "@renpy/ast/out/tokenizer/tokenizer";
import { parseRenpyFiles } from "../../src/parser/parser";
import { renpyScriptArbitrary } from "./arbitraries";

const numRuns = process.env.DEEP_FUZZ ? 5000 : 100;

describe("Ren'Py Parser Fuzz Testing Suite", () => {
  beforeEach(() => {
    Tokenizer.clearTokenCache();
  });

  it(
    `fuzzes parseRenpyFiles with malformed script strings (${numRuns} runs)`,
    async () => {
      await fc.assert(
        fc.asyncProperty(renpyScriptArbitrary, async (scriptContent) => {
          Tokenizer.clearTokenCache();

          // Action under test
          const result = await parseRenpyFiles([
            { name: "fuzz_input.rpy", content: scriptContent },
          ]);

          // Safety invariants: Must never crash, must return valid result object arrays
          expect(result).toBeDefined();
          expect(Array.isArray(result.nodes)).toBe(true);
          expect(Array.isArray(result.edges)).toBe(true);
          expect(result.diagnostics === undefined || Array.isArray(result.diagnostics)).toBe(true);
        }),
        {
          numRuns,
          interruptAfterTimeLimit: 15000,
        },
      );
    },
    30000,
  );

  it(
    `fuzzes parseRenpyFiles with arbitrary binary byte strings (${numRuns} runs)`,
    async () => {
      await fc.assert(
        fc.asyncProperty(fc.fullUnicodeString({ maxLength: 2000 }), async (randomText) => {
          Tokenizer.clearTokenCache();

          const result = await parseRenpyFiles([
            { name: "random_bytes.rpy", content: randomText },
          ]);

          expect(result).toBeDefined();
          expect(Array.isArray(result.nodes)).toBe(true);
          expect(Array.isArray(result.edges)).toBe(true);
        }),
        {
          numRuns,
          interruptAfterTimeLimit: 15000,
        },
      );
    },
    30000,
  );
});
