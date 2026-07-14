import { describe, expect, it } from "vitest";
import {
  calculateReadingTimeSeconds,
  formatReadingTime,
} from "../../src/ui/utils/readingTime.ts";
import { computeTextStats } from "../../src/parser/tokenHandling.ts";

// --- computeTextStats --------------------------------------------------------

describe("computeTextStats", () => {
  it("counts words in plain text", () => {
    const { wordCount, pauseDuration } = computeTextStats("Hello world foo");
    expect(wordCount).toBe(3);
    expect(pauseDuration).toBe(0);
  });

  it("strips Ren'Py text tags before word counting", () => {
    const { wordCount } = computeTextStats("{b}Hello{/b} {i}world{/i}");
    expect(wordCount).toBe(2);
  });

  it("counts explicit pause durations with {w=N}", () => {
    const { pauseDuration } = computeTextStats("Hello {w=2.5} world {w=1.0}");
    expect(pauseDuration).toBeCloseTo(3.5);
  });

  it("counts explicit pause durations with {p=N}", () => {
    const { pauseDuration } = computeTextStats("Hello {p=1.0} world");
    expect(pauseDuration).toBeCloseTo(1.0);
  });

  it("ignores plain {w} with no numeric argument", () => {
    const { pauseDuration } = computeTextStats("Hello {w} world");
    expect(pauseDuration).toBe(0);
  });

  it("ignores plain {p} with no numeric argument", () => {
    const { pauseDuration } = computeTextStats("{p}Click to continue");
    expect(pauseDuration).toBe(0);
  });

  it("handles empty string", () => {
    const { wordCount, pauseDuration } = computeTextStats("");
    expect(wordCount).toBe(0);
    expect(pauseDuration).toBe(0);
  });

  it("handles string with only tags", () => {
    const { wordCount } = computeTextStats("{w=1.0}{b}{/b}");
    expect(wordCount).toBe(0);
  });

  it("handles mixed tags and pauses", () => {
    const result = computeTextStats("She said {b}wait{/b}.{w=0.5} Then smiled.");
    expect(result.wordCount).toBe(5); // "She", "said", "wait.", "Then", "smiled."
    expect(result.pauseDuration).toBeCloseTo(0.5);
  });
});

// --- calculateReadingTimeSeconds ----------------------------------------------

describe("calculateReadingTimeSeconds", () => {
  it("returns 0 for zero words and zero pause", () => {
    expect(calculateReadingTimeSeconds(0, 0, 200)).toBe(0);
  });

  it("computes reading time from word count", () => {
    // 200 words at 200 WPM = 60 seconds
    expect(calculateReadingTimeSeconds(200, 0, 200)).toBe(60);
  });

  it("adds pause duration to reading time", () => {
    // 200 words at 200 WPM = 60 seconds, + 5 second pause = 65 seconds
    expect(calculateReadingTimeSeconds(200, 5, 200)).toBe(65);
  });

  it("works with different WPM speeds", () => {
    // 100 words at 100 WPM = 60 seconds
    expect(calculateReadingTimeSeconds(100, 0, 100)).toBe(60);
    // 100 words at 400 WPM = 15 seconds
    expect(calculateReadingTimeSeconds(100, 0, 400)).toBe(15);
  });

  it("handles zero words with only pauses", () => {
    expect(calculateReadingTimeSeconds(0, 3.0, 200)).toBe(3.0);
  });
});

// --- formatReadingTime --------------------------------------------------------

describe("formatReadingTime", () => {
  it("formats 0 seconds", () => {
    expect(formatReadingTime(0)).toBe("0s");
  });

  it("formats seconds only", () => {
    expect(formatReadingTime(45)).toBe("45s");
  });

  it("formats minutes and seconds", () => {
    expect(formatReadingTime(90)).toBe("1m 30s");
  });

  it("formats exact minutes", () => {
    expect(formatReadingTime(120)).toBe("2m");
  });

  it("formats hours and minutes", () => {
    expect(formatReadingTime(3661)).toBe("1h 1m");
  });

  it("formats exact hours", () => {
    expect(formatReadingTime(3600)).toBe("1h");
  });

  it("rounds fractional seconds", () => {
    expect(formatReadingTime(1.6)).toBe("2s");
    expect(formatReadingTime(1.4)).toBe("1s");
  });
});
