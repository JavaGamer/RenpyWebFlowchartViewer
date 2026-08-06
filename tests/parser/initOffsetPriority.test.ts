import { describe, expect, it } from "vitest";
import { parseRenpyFiles } from "../../src/parser/parser.ts";

describe("init offset and Python Init Priority Parsing", () => {
  it("resets init offset per file and calculates priority correctly across files", async () => {
    const files = [
      {
        name: "01_offset_a.rpy",
        content: [
          "init offset = 20",
          "init -5 python:",
          '    mode = "offset_twenty_minus_five"', // Calculated priority 15
        ].join("\n"),
      },
      {
        name: "02_offset_b.rpy",
        content: [
          // Starts at offset 0
          "init 10 python:",
          '    mode = "priority_ten"', // Calculated priority 10
        ].join("\n"),
      },
      {
        name: "main.rpy",
        content: [
          "label start:",
          "    jump expression mode",
          "",
          "label offset_twenty_minus_five:",
          "    return",
          "",
          "label priority_ten:",
          "    return",
        ].join("\n"),
      },
    ];

    const result = await parseRenpyFiles(files);
    // Calculated priority 15 > 10, so mode should resolve to "offset_twenty_minus_five"
    expect(result.edges).toContainEqual(
      expect.objectContaining({
        source: "start",
        target: "offset_twenty_minus_five",
        kind: "jump",
      }),
    );
  });

  it("overrides init offset within a single file with absolute positioning", async () => {
    const files = [
      {
        name: "accumulate.rpy",
        content: [
          "init offset = 10",
          "init offset = -25", // Absolute offset is now -25 (not accumulated 10 + -25)
          "define value = 'offset_neg_twentyfive'", // Calculated priority -25
        ].join("\n"),
      },
      {
        name: "override.rpy",
        content: [
          "init -10 python:",
          '    value = "priority_neg_ten"', // Calculated priority -10 (executed after -25)
        ].join("\n"),
      },
      {
        name: "main.rpy",
        content: [
          "label start:",
          "    jump expression value",
          "",
          "label offset_neg_twentyfive:",
          "    $ pass",
          "",
          "label priority_neg_ten:",
          "    $ pass",
        ].join("\n"),
      },
    ];

    const result = await parseRenpyFiles(files);
    // -10 executes after -25, so value becomes "priority_neg_ten"
    expect(result.edges).toContainEqual(
      expect.objectContaining({
        source: "start",
        target: "priority_neg_ten",
        kind: "jump",
      }),
    );
  });

  it("enforces define < default execution order at equal priority", async () => {
    const files = [
      {
        name: "defaults.rpy",
        content: [
          'default target_lbl = "lbl_default"',
          'define target_lbl = "lbl_defined"',
          "",
          "label start:",
          "    jump expression target_lbl",
          "",
          "label lbl_default:",
          "    return",
          "",
          "label lbl_defined:",
          "    return",
        ].join("\n"),
      },
    ];

    const result = await parseRenpyFiles(files);
    // define executes before default at priority 0; default does not overwrite define
    expect(result.edges).toContainEqual(
      expect.objectContaining({
        source: "start",
        target: "lbl_defined",
        kind: "jump",
      }),
    );
  });

  it("handles python early fixed priority of -10000", async () => {
    const files = [
      {
        name: "early.rpy",
        content: [
          "init offset = 50",
          "python early:",
          '    early_val = "first"',
          "define early_val = 'second'", // Priority 50
          "",
          "label start:",
          "    jump expression early_val",
          "",
          "label first:",
          "    return",
          "",
          "label second:",
          "    return",
        ].join("\n"),
      },
    ];

    const result = await parseRenpyFiles(files);
    // python early (-10000) runs first, then define at 50 overrides it
    expect(result.edges).toContainEqual(
      expect.objectContaining({
        source: "start",
        target: "second",
        kind: "jump",
      }),
    );
  });
});
