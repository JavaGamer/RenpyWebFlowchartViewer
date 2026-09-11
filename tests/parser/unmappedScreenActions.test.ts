import { describe, expect, it } from "vitest";
import { parseRenpyFiles } from "../../src/parser/index.ts";

describe("Unmapped Screen Action Discovery", () => {
  it("emits unmapped_screen_action diagnostic for unrecognized screen actions", async () => {
    const screensRpy = `
screen test_screen:
    textbutton "Play Minigame":
        action MysteryMinigameAction("level_1")
    textbutton "Standard Jump":
        action Jump("target_label")
`;

    const scriptRpy = `
label start:
    call screen test_screen

label target_label:
    return
`;

    const result = await parseRenpyFiles([
      { name: "screens.rpy", content: screensRpy },
      { name: "script.rpy", content: scriptRpy },
    ]);

    const unmappedDiags = (result.diagnostics ?? []).filter(
      (d) => d.code === "unmapped_screen_action",
    );

    expect(unmappedDiags.length).toBe(1);
    expect(unmappedDiags[0].code).toBe("unmapped_screen_action");
    expect(unmappedDiags[0].location).toMatchObject({
      chapter: "screens.rpy",
      actionName: "MysteryMinigameAction",
      targetExpression: '"level_1"',
    });
  });

  it("does not emit diagnostic for built-in or ignored screen actions", async () => {
    const screensRpy = `
screen navigation:
    textbutton "Start":
        action Start()
    textbutton "Preferences":
        action ShowMenu("preferences")
    textbutton "Confirm":
        action Confirm("Are you sure?", Jump("quit_game"))
    textbutton "Return":
        action Return()
    textbutton "Null":
        action NullAction()
`;

    const scriptRpy = `
label start:
    call screen navigation

label quit_game:
    return
`;

    const result = await parseRenpyFiles([
      { name: "screens.rpy", content: screensRpy },
      { name: "script.rpy", content: scriptRpy },
    ]);

    const unmappedDiags = (result.diagnostics ?? []).filter(
      (d) => d.code === "unmapped_screen_action",
    );

    expect(unmappedDiags.length).toBe(0);
  });

  it("does not emit diagnostic when custom rule maps the action", async () => {
    const screensRpy = `
screen custom_screen:
    textbutton "Custom Warp":
        action CustomWarp("secret_room")
`;

    const scriptRpy = `
label start:
    call screen custom_screen

label secret_room:
    "You warped here!"
    return
`;

    // Without custom rule -> emits diagnostic
    const unmappedResult = await parseRenpyFiles([
      { name: "screens.rpy", content: screensRpy },
      { name: "script.rpy", content: scriptRpy },
    ]);
    expect(
      (unmappedResult.diagnostics ?? []).some(
        (d) => d.code === "unmapped_screen_action",
      ),
    ).toBe(true);

    // With custom rule -> no diagnostic, creates jump edge
    const mappedResult = await parseRenpyFiles(
      [
        { name: "screens.rpy", content: screensRpy },
        { name: "script.rpy", content: scriptRpy },
      ],
      {
        screenActionRules: [
          { actionName: "CustomWarp", actionKind: "jump" },
        ],
      },
    );

    const diags = (mappedResult.diagnostics ?? []).filter(
      (d) => d.code === "unmapped_screen_action",
    );
    expect(diags.length).toBe(0);

    const edges = mappedResult.edges;
    const jumpEdge = edges.find((e) => e.target === "secret_room");
    expect(jumpEdge).toBeDefined();
  });
});
