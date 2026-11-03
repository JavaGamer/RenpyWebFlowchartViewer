import { describe, expect, it, vi } from "vitest";
import { validateSafeRegexPattern } from "../../src/parser/plugins/regexValidator.ts";

describe("validateSafeRegexPattern", () => {
  it("compiles valid safe regexes and strips g and y flags", () => {
    const rx = validateSafeRegexPattern("hello_world", "giy");
    expect(rx.test("hello_world")).toBe(true);
    expect(rx.global).toBe(false);
    expect(rx.sticky).toBe(false);
    expect(rx.ignoreCase).toBe(true);
  });

  it("adds pattern literals to benchmark probes for diverse characters", () => {
    const rx = validateSafeRegexPattern("quick_brown_fox_123");
    expect(rx.test("quick_brown_fox_123")).toBe(true);
  });

  it("throws on empty or whitespace pattern", () => {
    expect(() => validateSafeRegexPattern("")).toThrow(
      "Regex pattern must not be empty.",
    );
    expect(() => validateSafeRegexPattern("   \t  ")).toThrow(
      "Regex pattern must not be empty.",
    );
  });

  it("throws when pattern exceeds 300 characters", () => {
    const longPattern = "a".repeat(301);
    expect(() => validateSafeRegexPattern(longPattern)).toThrow(
      "Regex pattern exceeds maximum length of 300 characters",
    );
  });

  it("throws on nested quantifiers", () => {
    expect(() => validateSafeRegexPattern("(a+)+")).toThrow(
      "contains nested quantifiers",
    );
    expect(() => validateSafeRegexPattern("(a{1,2})+")).toThrow(
      "contains nested quantifiers",
    );
    expect(() => validateSafeRegexPattern("(\\w*)*")).toThrow(
      "contains nested quantifiers",
    );
  });

  it("throws on quantified alternation branches with outer repetition", () => {
    expect(() => validateSafeRegexPattern("(a+|b)+")).toThrow(
      "contains quantified alternation branches with outer repetition",
    );
  });

  it("throws on identical or overlapping alternations with quantifiers", () => {
    expect(() => validateSafeRegexPattern("(target|target)+")).toThrow(
      "contains overlapping alternations with quantifiers",
    );
    expect(() => validateSafeRegexPattern("(\\w|\\w)+")).toThrow(
      "contains overlapping alternations with quantifiers",
    );
    expect(() => validateSafeRegexPattern("([a-z]|\\w)+")).toThrow(
      "contains overlapping alternations with quantifiers",
    );
  });

  it("throws on syntax errors in regular expression", () => {
    expect(() => validateSafeRegexPattern("[unclosed-group")).toThrow(
      "Invalid regular expression",
    );
  });

  it("throws when pattern matches empty string", () => {
    expect(() => validateSafeRegexPattern("a*")).toThrow(
      "must not match an empty string",
    );
    expect(() => validateSafeRegexPattern("^$")).toThrow(
      "must not match an empty string",
    );
  });

  it("throws when pattern matches pure whitespace", () => {
    expect(() => validateSafeRegexPattern("\\s+")).toThrow(
      "must not match pure whitespace",
    );
  });

  it("throws when benchmark probe detects excessive execution time", () => {
    let callCount = 0;
    const originalNow = performance.now;
    vi.spyOn(performance, "now").mockImplementation(() => {
      callCount++;
      // Return a large elapsed time on probe execution
      return callCount % 2 === 0 ? 500 : 0;
    });

    try {
      expect(() => validateSafeRegexPattern("complex_item")).toThrow(
        "exhibited excessive execution time on benchmark probe",
      );
    } finally {
      performance.now = originalNow;
      vi.restoreAllMocks();
    }
  });

  it("handles environment fallback when performance is undefined", () => {
    const originalPerformance = globalThis.performance;
    try {
      // @ts-expect-error test undefined performance fallback
      delete globalThis.performance;
      const rx = validateSafeRegexPattern("fallback_check");
      expect(rx.test("fallback_check")).toBe(true);
    } finally {
      globalThis.performance = originalPerformance;
    }
  });
});
