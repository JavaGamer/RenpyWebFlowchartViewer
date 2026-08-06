import { describe, expect, it } from "vitest";
import { parseRenpyFiles } from "../../src/parser/parser.ts";

describe("Cross-File Variable & Init Extraction", () => {
  it("resolves multi-pass init variables and define vs default precedence across files", async () => {
    const file1 = {
      name: "script.rpy",
      content: `
default persistent.ending_unlocked = False
default quest_stage = 0
define chapter_title = "Prologue"

label start:
    $ quest_stage += 1
    if quest_stage == 1:
        jump ch1
`,
    };

    const file2 = {
      name: "definitions.rpy",
      content: `
define quest_stage = 10
$ persistent.ending_unlocked = True
`,
    };

    const result = await parseRenpyFiles([file1, file2]);

    expect(result.nodes.length).toBeGreaterThan(0);

    // Verify cross-file init variable extraction dictionary
    const initVars = result.initVariables;
    expect(initVars).toBeDefined();

    // define (priority 10, file2) takes precedence over default (priority 10, file1)
    const questStageDesc = initVars?.get("quest_stage");
    expect(questStageDesc).toBeDefined();
    expect(questStageDesc?.kind).toBe("define");
    expect(questStageDesc?.value).toBe("10");

    // Verify persistent variable extraction
    const endingDesc = initVars?.get("persistent.ending_unlocked");
    expect(endingDesc).toBeDefined();
    expect(endingDesc?.isPersistent).toBe(true);
    expect(endingDesc?.value).toBe(true);

    // Verify define string constant
    const titleDesc = initVars?.get("chapter_title");
    expect(titleDesc?.value).toBe("Prologue");

    const falseEdge = result.edges.find((e) => e.conditionIsStaticallyFalse);
    expect(falseEdge).toBeDefined();
  });
});
