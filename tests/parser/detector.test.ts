import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { detectParserVariant } from "../../src/parser/plugins/detector.ts";
import {
  clearCustomParserVariantPlugins,
  registerParserVariantPlugin,
} from "../../src/parser/plugins/pluginRegistry.ts";
import type { ParserVariantPlugin } from "../../src/parser/plugins/types.ts";

describe("detectParserVariant", () => {
  beforeEach(() => {
    // Register custom plugins with known signatures for testing
    const testPluginA: ParserVariantPlugin = {
      id: "plugin_alpha",
      label: "Plugin Alpha",
      isCustom: true,
      defaultScreenActionRules: [],
      detectionFilePatterns: [/alpha_file_\d+\.rpy/i],
      detectionSignatures: [
        /alpha_global_marker_\w+/g, // global regex (> 20 chars)
        /alpha_short/g, // global short regex (<= 25 chars)
        /alpha_cmd\s+\w+/, // non-global short regex (<= 25 chars)
      ],
    };

    const testPluginB: ParserVariantPlugin = {
      id: "plugin_beta",
      label: "Plugin Beta",
      isCustom: true,
      defaultScreenActionRules: [],
      detectionFilePatterns: [/beta_dir[\\/].*\.rpy/i],
      detectionSignatures: [/beta_signature_unique_keyword/],
    };

    registerParserVariantPlugin(testPluginA);
    registerParserVariantPlugin(testPluginB);
  });

  afterEach(() => {
    clearCustomParserVariantPlugins();
  });

  it("detects explicit pragma override in file header", () => {
    // 1. With named file
    const res1 = detectParserVariant([
      {
        name: "game/script.rpy",
        content: "# @variant: plugin_alpha\nlabel start:\n    return\n",
      },
    ]);
    expect(res1.variant).toBe("plugin_alpha");
    expect(res1.pragmaOverride).toBe(true);
    expect(res1.confidence).toBe(100);

    // 2. With unnamed script
    const res2 = detectParserVariant([
      "# @flowchart-variant: plugin_beta\nlabel start:\n    return\n",
    ]);
    expect(res2.variant).toBe("plugin_beta");
    expect(res2.pragmaOverride).toBe(true);

    // 3. Pragma with auto or unknown variant falls back to scanning
    const res3 = detectParserVariant([
      "# @variant: auto\n# @variant: unknown_vn\nlabel start:\n    return\n",
    ]);
    expect(res3.pragmaOverride).toBeUndefined();
    expect(res3.variant).toBe("renpy");
  });

  it("handles null, empty, and string inputs and normalizes windows slashes", () => {
    type FileInput = Parameters<typeof detectParserVariant>[0][number];
    const res = detectParserVariant([
      null as unknown as FileInput,
      undefined as unknown as FileInput,
      "",
      {
        name: "game\\scripts\\test.rpy",
        path: "game\\scripts\\test.rpy",
        content: "",
      },
      { contentSample: 'label start:\n    "hello"' },
    ]);
    expect(res.variant).toBe("renpy");
    expect(res.confidence).toBe(0);
    expect(res.candidates).toEqual([]);
  });

  it("scores path patterns and accumulates multiple sample locations", () => {
    const files = [
      {
        name: "alpha_file_1.rpy",
        path: "scripts/alpha_file_1.rpy",
        content: "",
      },
      {
        name: "alpha_file_2.rpy",
        path: "scripts/alpha_file_2.rpy",
        content: "",
      },
      {
        name: "alpha_file_3.rpy",
        path: "scripts/alpha_file_3.rpy",
        content: "",
      },
      {
        name: "alpha_file_4.rpy",
        path: "scripts/alpha_file_4.rpy",
        content: "",
      },
    ];

    const res = detectParserVariant(files);
    expect(res.variant).toBe("plugin_alpha");
    expect(res.evidence.matchedPathPatterns.length).toBeGreaterThan(0);
    const alphaCandidate = res.candidates?.find((c) =>
      c.variantId === "plugin_alpha"
    );
    const pathEvidence = alphaCandidate?.evidence.find((e) =>
      e.signature.startsWith("File pattern:")
    );
    expect(pathEvidence?.matchCount).toBe(4);
    expect(pathEvidence?.sampleLocations.length).toBe(3); // capped at 3
  });

  it("scores content signatures with both global and non-global regexes across multiple files", () => {
    const files = [
      {
        name: "file1.rpy",
        content: `
alpha_global_marker_first
alpha_global_marker_second
alpha_short
alpha_cmd action
`,
      },
      {
        name: "file2.rpy",
        content: `
alpha_global_marker_third
alpha_cmd another_action
`,
      },
    ];

    const res = detectParserVariant(files);
    expect(res.variant).toBe("plugin_alpha");
    expect(res.confidencePercent).toBe(98); // score >= 15 with no runner up
  });

  it("calculates confidence tiers when score is below 15 and below 6", () => {
    // 1. Medium score (>= 6 and < 15)
    const resMedium = detectParserVariant([
      {
        name: "alpha_file_1.rpy", // +8 points
        content: "",
      },
    ]);
    expect(resMedium.variant).toBe("plugin_alpha");
    expect(resMedium.confidencePercent).toBe(92);

    // 2. Low score (< 6): non-global short signature match on 1 line (+3 points)
    const resLow = detectParserVariant([
      {
        name: "other.rpy",
        content: "alpha_cmd foo",
      },
    ]);
    expect(resLow.variant).toBe("plugin_alpha");
    expect(resLow.confidencePercent).toBe(80);
  });

  it("computes competitive runner-up confidence when multiple plugins match", () => {
    const files = [
      {
        name: "alpha_file_1.rpy",
        content: "alpha_cmd foo\nbeta_signature_unique_keyword",
      },
    ];

    const res = detectParserVariant(files);
    expect(res.candidates?.length).toBe(2);
    // Winner is alpha, runner-up is beta
    expect(res.variant).toBe("plugin_alpha");
    expect(res.confidencePercent).toBeGreaterThanOrEqual(50);
    expect(res.confidencePercent).toBeLessThanOrEqual(99);
  });
});
