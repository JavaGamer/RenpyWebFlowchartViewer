import { describe, expect, it } from "vitest";
import { parseRenpyFiles } from "../../src/parser/parser.ts";
import type { ParseInputFile } from "../../src/parser/pipelineTypes.ts";

// ── 1. Seed Corpus ───────────────────────────────────────────────────────────
const SEED_CORPUS: string[] = [
  // Seed 1: Standard control flow & subroutines
  `label start:\n    "Hello world"\n    jump chapter1\n\nlabel chapter1:\n    e "Welcome to the story"\n    call subroutine_a\n    return\n\nlabel subroutine_a:\n    "Subroutine line"\n    return\n`,

  // Seed 2: Conditional blocks, loops, and menus
  `label menu_test:\n    $ choice_count = 0\n    while choice_count < 3:\n        menu:\n            "Option 1":\n                $ choice_count += 1\n                jump target_a\n            "Option 2" if choice_count > 1:\n                if flag_x:\n                    call sub_routine\n                else:\n                    jump target_b\n`,

  // Seed 3: Python blocks and init declarations
  `define config.name = "Test Novel"\ndefault has_item = False\ninit -5 python:\n    persistent.unlocked_endings = []\n\nlabel py_test:\n    $ has_item = True\n    python:\n        x = 10\n        y = 20\n    return\n`,

  // Seed 4: Screen definitions with actions
  `screen main_menu():\n    style_prefix "main_menu"\n    textbutton _("Start") action Start()\n    textbutton _("Quit") action Quit(confirm=False)\n`,

  // Seed 5: Multi-file duplicate/shadowed labels
  `label shared_label:\n    "First definition"\n    jump next_part\n`,
];

// ── 2. Mutation Operators ───────────────────────────────────────────────────
type MutationOp = (script: string) => string;

const MUTATORS: MutationOp[] = [
  // M1: Corrupt Indentation (mix spaces/tabs, random indent drops)
  (s) =>
    s
      .split("\n")
      .map((line) => Math.random() > 0.4 ? "\t" + line : "  " + line)
      .join("\n"),

  // M2: Strip or Replace Colons
  (s) => s.replace(/:/g, () => (Math.random() > 0.5 ? "" : ";")),

  // M3: Break String Quotes
  (s) => s.replace(/"/g, () => (Math.random() > 0.5 ? ' "' : "")),

  // M4: Inject Random Keywords / Tokens
  (s) =>
    s +
    "\nlabel corrupted_" +
    Math.floor(Math.random() * 1000) +
    ":\n    invalid_keyword_token 123\n",

  // M5: Truncate Script at Random Offset
  (s) => s.slice(0, Math.floor(s.length * Math.random())),

  // M6: Duplicate Headers & Unclosed Blocks
  (s) => s + "\nmenu:\n    if True:\n",
];

function mutate(seed: string, iterations = 3): string {
  let current = seed;
  for (let i = 0; i < iterations; i++) {
    const mutator = MUTATORS[Math.floor(Math.random() * MUTATORS.length)]!;
    current = mutator(current);
  }
  return current;
}

// ── 3. Fuzz Test Suite ───────────────────────────────────────────────────────
describe("Automated Property-Based Parser Fuzzing", () => {
  const FUZZ_RUNS = 100;

  it(`survives ${FUZZ_RUNS} property-based random mutations without crashing or producing corrupt graph states`, async () => {
    for (let run = 0; run < FUZZ_RUNS; run++) {
      const seed = SEED_CORPUS[run % SEED_CORPUS.length]!;
      const fuzzedContent = mutate(seed, 1 + (run % 4));

      const files: ParseInputFile[] = [{
        name: `fuzzed_run_${run}.rpy`,
        content: fuzzedContent,
      }];

      // 1. Parser Panic-Free Guarantee
      let result;
      try {
        result = await parseRenpyFiles(files, { maxParallelFiles: 1 });
      } catch (err) {
        throw new Error(
          `Parser threw uncaught exception on fuzz run ${run}:\n${err}\nFuzzed Script Input:\n${fuzzedContent}`,
        );
      }

      // 2. Structural Invariant Assertions
      expect(Array.isArray(result.nodes)).toBe(true);
      expect(Array.isArray(result.edges)).toBe(true);

      const nodeIds = new Set(result.nodes.map((n) => n.id));
      expect(nodeIds.size).toBe(result.nodes.length); // All node IDs must be unique

      // Assert no invalid edge references
      for (const edge of result.edges) {
        expect(typeof edge.source).toBe("string");
        expect(typeof edge.target).toBe("string");
        expect(nodeIds.has(edge.source)).toBe(true);
      }

      // Assert valid dialogue counts
      for (const node of result.nodes) {
        if (typeof node.dialogueCount === "number") {
          expect(node.dialogueCount).toBeGreaterThanOrEqual(0);
        }
      }

      // Assert diagnostic structure integrity
      if (result.diagnostics) {
        for (const diag of result.diagnostics) {
          expect(["warning", "error"]).toContain(diag.severity);
          expect(typeof diag.message).toBe("string");
        }
      }
    }
  });

  it("handles corrupted raw UTF-8 byte input gracefully", async () => {
    // Malformed UTF-8 sequence bytes
    const invalidUtf8Bytes = new Uint8Array([
      0x6c,
      0x61,
      0x62,
      0x65,
      0x6c,
      0x20,
      0xff,
      0xfe,
      0x80,
      0x3a,
      0x0a,
    ]);
    const files: ParseInputFile[] = [{
      name: "corrupted_bytes.rpy",
      content: invalidUtf8Bytes,
    }];

    const result = await parseRenpyFiles(files);
    expect(result.nodes).toBeDefined();
    expect(result.edges).toBeDefined();
    expect(Array.isArray(result.nodes)).toBe(true);
  });
});
