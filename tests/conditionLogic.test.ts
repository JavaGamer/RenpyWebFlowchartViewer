import { describe, expect, it } from "vitest";
import {
  evaluateConditionExpression,
  extractConditionFlagRefs,
} from "../src/domain/conditionLogic";

describe("conditionLogic", () => {
  it("returns unknown when unsupported tokens remain after tokenization", () => {
    expect(evaluateConditionExpression("flag_a + 1", { flag_a: "true" })).toBe(
      "unknown",
    );
  });

  it("evaluates supported boolean expressions as before", () => {
    expect(
      evaluateConditionExpression("flag_a and not flag_b", {
        flag_a: "true",
        flag_b: "false",
      }),
    ).toBe("true");
  });

  it("evaluates python-style operators and comparisons", () => {
    // True/False literal checks
    expect(evaluateConditionExpression("flag_a == True", { flag_a: "true" }))
      .toBe("true");
    expect(evaluateConditionExpression("flag_a == False", { flag_a: "false" }))
      .toBe("true");
    expect(evaluateConditionExpression("flag_a is True", { flag_a: "true" }))
      .toBe("true");
    expect(
      evaluateConditionExpression("flag_a is not True", { flag_a: "false" }),
    ).toBe("true");
    expect(evaluateConditionExpression("flag_a is False", { flag_a: "false" }))
      .toBe("true");
    expect(evaluateConditionExpression("flag_a is None", { flag_a: "false" }))
      .toBe("true");
    expect(
      evaluateConditionExpression("flag_a is not None", { flag_a: "true" }),
    ).toBe("true");
    expect(evaluateConditionExpression("flag_a is null", { flag_a: "false" }))
      .toBe("true");
    expect(
      evaluateConditionExpression("flag_a is not null", { flag_a: "true" }),
    ).toBe("true");
  });

  describe("extractConditionFlagRefs", () => {
    it("extracts flag references correctly and ignores keywords/literals", () => {
      expect(extractConditionFlagRefs("flag_a == True")).toEqual(["flag_a"]);
      expect(extractConditionFlagRefs("flag_a is not None")).toEqual([
        "flag_a",
      ]);
      expect(extractConditionFlagRefs("flag_a is null")).toEqual(["flag_a"]);
      expect(extractConditionFlagRefs("flag_a and flag_b or flag_c")).toEqual([
        "flag_a",
        "flag_b",
        "flag_c",
      ]);
    });
  });
});
