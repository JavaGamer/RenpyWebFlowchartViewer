import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  evaluateConditionExpression,
  extractConditionFlagRefs,
  type MockFlagValue,
} from "../../src/domain/conditionLogic";
import { conditionExpressionArbitrary } from "./arbitraries";

const numRuns = process.env.DEEP_FUZZ ? 5000 : 100;

describe("Condition Logic Fuzz Testing Suite", () => {
  it(
    `fuzzes extractConditionFlagRefs with arbitrary expressions (${numRuns} runs)`,
    () => {
      fc.assert(
        fc.property(conditionExpressionArbitrary, (expr) => {
          const refs = extractConditionFlagRefs(expr);

          // Invariant: Must return an array of strings without throwing
          expect(Array.isArray(refs)).toBe(true);
          expect(refs.every((r) => typeof r === "string")).toBe(true);
        }),
        { numRuns },
      );
    },
  );

  it(
    `fuzzes evaluateConditionExpression with arbitrary expressions and flag states (${numRuns} runs)`,
    () => {
      const mockFlagsArbitrary = fc.dictionary(
        fc.stringMatching(/^[a-zA-Z_][a-zA-Z0-9_]*$/),
        fc.constantFrom<MockFlagValue>("true", "false", "unknown"),
      );

      fc.assert(
        fc.property(conditionExpressionArbitrary, mockFlagsArbitrary, (expr, flags) => {
          const result = evaluateConditionExpression(expr, flags);

          // Invariant: Must return one of "true", "false", or "unknown"
          expect(["true", "false", "unknown"]).toContain(result);
        }),
        { numRuns },
      );
    },
  );
});
