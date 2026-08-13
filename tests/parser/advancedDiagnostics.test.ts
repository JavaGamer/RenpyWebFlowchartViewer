import { describe, expect, it } from "vitest";
import { parseRenpyFiles } from "../../src/parser/parser.ts";

describe("Advanced Static Diagnostics & Flow Analysis", () => {
  describe("Dead Branch & Menu Option Condition Analysis", () => {
    it("flags menu options with statically false condition 'if False:'", async () => {
      const files = [
        {
          name: "menu_false.rpy",
          content: `
label start:
    menu:
        "Valid Choice":
            jump good_end
        "Dead Choice" if False:
            jump bad_end

label good_end:
    "Good ending reached"

label bad_end:
    "Bad ending reached"
`,
        },
      ];

      const result = await parseRenpyFiles(files);

      expect(result.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "normalization",
            context: expect.objectContaining({
              category: "dead_menu_option",
            }),
            message: expect.stringContaining("Dead Choice"),
          }),
        ]),
      );

      // Verify the dead edge is flagged as statically false
      const deadEdge = result.edges.find((e) => e.label === "Dead Choice");
      expect(deadEdge?.conditionIsStaticallyFalse).toBe(true);
    });

    it("flags menu options with unsatisfiable variable states", async () => {
      const files = [
        {
          name: "menu_unsatisfiable.rpy",
          content: `
label start:
    $ has_key = False
    menu:
        "Open door without key":
            jump normal_room
        "Unlock with gold key" if has_key == True:
            jump treasure_room

label normal_room:
    "You are in a normal room"

label treasure_room:
    "You unlocked the treasure room!"
`,
        },
      ];

      const result = await parseRenpyFiles(files);

      expect(result.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "normalization",
            context: expect.objectContaining({
              category: "dead_menu_option",
            }),
            message: expect.stringContaining("Unlock with gold key"),
          }),
        ]),
      );

      const treasureEdge = result.edges.find((e) =>
        e.label === "Unlock with gold key"
      );
      expect(treasureEdge?.conditionIsStaticallyFalse).toBe(true);
    });

    it("does not flag menu options when condition is satisfiable or unknown", async () => {
      const files = [
        {
          name: "menu_valid.rpy",
          content: `
label start:
    $ coins = 10
    menu:
        "Buy apple" if coins >= 5:
            jump shop_end
        "Buy nothing":
            jump leave

label shop_end:
    "You bought an apple"

label leave:
    "You left"
`,
        },
      ];

      const result = await parseRenpyFiles(files);

      const deadDiagnostics = result.diagnostics?.filter(
        (d) =>
          d.context?.category === "dead_menu_option" ||
          d.context?.category === "dead_branch",
      );
      expect(deadDiagnostics ?? []).toHaveLength(0);
    });
  });

  describe("Dangling Stack & Subroutine Guarding", () => {
    it("detects missing return at label boundary causing unintentional fallthrough", async () => {
      const files = [
        {
          name: "subroutine_fallthrough.rpy",
          content: `
label start:
    call helper_subroutine
    "Returned to start"

label helper_subroutine:
    "Doing work inside helper"
    # Note: forgot 'return', falls through to next label!

label next_unrelated_label:
    "This is an unrelated label"
`,
        },
      ];

      const result = await parseRenpyFiles(files);

      expect(result.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "normalization",
            context: expect.objectContaining({
              category: "dangling_stack",
              detail: "helper_subroutine",
            }),
            message: expect.stringContaining("dangling call stack frame"),
          }),
        ]),
      );
    });

    it("does not emit dangling stack warning when subroutine properly returns", async () => {
      const files = [
        {
          name: "subroutine_valid.rpy",
          content: `
label start:
    call helper_subroutine
    "Returned to start"

label helper_subroutine:
    "Doing work inside helper"
    return

label next_unrelated_label:
    "This is an unrelated label"
`,
        },
      ];

      const result = await parseRenpyFiles(files);

      const danglingDiagnostics = result.diagnostics?.filter(
        (d) => d.context?.category === "dangling_stack",
      );
      expect(danglingDiagnostics ?? []).toHaveLength(0);
    });

    it("handles scene-split subroutines without false dangling stack or uncalled return", async () => {
      const files = [
        {
          name: "scene_split_sub.rpy",
          content: `
label start:
    call long_subroutine
    "Back in start"

label long_subroutine:
    scene bg room1
    "Scene 1 dialogue"
    scene bg room2
    "Scene 2 dialogue"
    return

label next_label:
    "Next label"
`,
        },
      ];

      const result = await parseRenpyFiles(files);

      const dangling = result.diagnostics?.filter(
        (d) => d.context?.category === "dangling_stack",
      );
      const uncalled = result.diagnostics?.filter(
        (d) => d.context?.category === "uncalled_return",
      );
      expect(dangling ?? []).toHaveLength(0);
      expect(uncalled ?? []).toHaveLength(0);
    });

    it("does not flag recursive calls that have a return base case", async () => {
      const files = [
        {
          name: "recursive_base_case.rpy",
          content: `
label start:
    call countdown

label countdown:
    if True:
        return
    call countdown
`,
        },
      ];

      const result = await parseRenpyFiles(files);

      const deadlocks = result.diagnostics?.filter(
        (d) => d.context?.category === "call_cycle_deadlock",
      );
      expect(deadlocks ?? []).toHaveLength(0);
    });

    it("evaluates Python truthiness for integers in menu options", async () => {
      const files = [
        {
          name: "menu_truthiness.rpy",
          content: `
label start:
    $ coins = 0
    menu:
        "Free item":
            jump done
        "Paid item" if coins:
            jump paid_done

label done:
    "Done"

label paid_done:
    "Paid done"
`,
        },
      ];

      const result = await parseRenpyFiles(files);

      expect(result.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "normalization",
            context: expect.objectContaining({
              category: "dead_menu_option",
            }),
            message: expect.stringContaining("Paid item"),
          }),
        ]),
      );
    });

    it("handles menu option conditions containing colons and strings", async () => {
      const files = [
        {
          name: "menu_colon.rpy",
          content: `
label start:
    $ mode = "hard"
    menu:
        "Choice" if mode == "mode:easy":
            jump easy
        "Choice 2":
            jump normal

label easy:
    "Easy"

label normal:
    "Normal"
`,
        },
      ];

      const result = await parseRenpyFiles(files);

      expect(result.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "normalization",
            context: expect.objectContaining({
              category: "dead_menu_option",
            }),
          }),
        ]),
      );
    });
  });
});
