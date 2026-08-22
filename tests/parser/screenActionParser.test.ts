import { describe, expect, it } from "vitest";
import { parseRenpyFiles } from "../../src/parser/parser.ts";

describe("Ren'Py Screen Action AST Parser", () => {
  it("parses Jump, Show, Hide, and ShowMenu screen actions", async () => {
    const files = [
      {
        name: "screens.rpy",
        content: [
          "label start:",
          "    screen navigation_ui():",
          '        textbutton "Start" action Jump("start_game")',
          '        textbutton "HUD" action Show("hud_screen")',
          '        textbutton "Dismiss" action Hide("hud_screen")',
          '        textbutton "Options" action ShowMenu("options_menu")',
          "",
          "screen options_menu():",
          '    textbutton "Back" action NullAction()',
          "",
          "label start_game:",
          "    $ pass",
        ].join("\n"),
      },
    ];

    const result = await parseRenpyFiles(files);
    expect(result.edges).toContainEqual(
      expect.objectContaining({
        kind: "jump",
        source: "start",
        target: "start_game",
      }),
    );
    expect(result.diagnostics ?? []).toEqual([]);
  });

  it("parses SetVariable and ToggleVariable actions, updating variable state", async () => {
    const files = [
      {
        name: "variables.rpy",
        content: [
          "default score = 0",
          "default hard_mode = False",
          "",
          "label start:",
          "    screen score_screen():",
          '        textbutton "Increase Score" action SetVariable("score", 10)',
          '        textbutton "Toggle Difficulty" action ToggleVariable("hard_mode")',
          "    if score > 0 or hard_mode:",
          '        "Score updated"',
        ].join("\n"),
      },
    ];

    const result = await parseRenpyFiles(files);
    expect(result.nodes).toContainEqual(
      expect.objectContaining({
        id: "start",
        label: "start",
      }),
    );
    expect(result.diagnostics ?? []).toEqual([]);
  });

  it("handles Confirm wrappers and action lists recursively", async () => {
    const files = [
      {
        name: "confirm_test.rpy",
        content: [
          "label start:",
          "    screen confirm_modal():",
          '        textbutton "Quit" action Confirm("Are you sure?", yes=Jump("exit_label"), no=NullAction())',
          '        textbutton "Multi" action [SetVariable("flag", True), Jump("multi_label")]',
          "    if flag:",
          '        "Flag set"',
          "",
          "label exit_label:",
          "    $ pass",
          "",
          "label multi_label:",
          "    $ pass",
        ].join("\n"),
      },
    ];

    const result = await parseRenpyFiles(files);
    const jumpTargets = result.edges
      .filter((e) => e.kind === "jump")
      .map((e) => e.target);

    expect(jumpTargets).toContain("exit_label");
    expect(jumpTargets).toContain("multi_label");
    expect(result.diagnostics ?? []).toEqual([]);
  });

  it("handles alternative action triggers (selected_action)", async () => {
    const files = [
      {
        name: "triggers.rpy",
        content: [
          "label start:",
          "    screen hover_test():",
          '        imagebutton auto "btn_%s" selected_action Jump("alt_route")',
          "",
          "label alt_route:",
          "    $ pass",
        ].join("\n"),
      },
    ];

    const result = await parseRenpyFiles(files);
    expect(result.edges).toContainEqual(
      expect.objectContaining({
        kind: "jump",
        source: "start",
        target: "alt_route",
      }),
    );
  });

  it("handles persistent variable SetVariable and ToggleVariable", async () => {
    const files = [
      {
        name: "persistent_test.rpy",
        content: [
          "label main:",
          "    screen persist_ui():",
          '        textbutton "Unlock" action SetVariable("persistent.unlocked", True)',
          "    if persistent.unlocked:",
          '        "Unlocked"',
        ].join("\n"),
      },
    ];

    const result = await parseRenpyFiles(files);
    expect(result.nodes).toContainEqual(
      expect.objectContaining({
        id: "main",
        label: "main",
      }),
    );
    expect(result.diagnostics ?? []).toEqual([]);
  });

  it("handles If screen action wrapper with true and false kwargs", async () => {
    const files = [
      {
        name: "if_kwargs.rpy",
        content: [
          "label start:",
          "    screen if_modal():",
          '        textbutton "Check" action If(has_key, true=Jump("key_route"), false=Jump("no_key_route"))',
          "",
          "label key_route:",
          "    $ pass",
          "",
          "label no_key_route:",
          "    $ pass",
        ].join("\n"),
      },
    ];

    const result = await parseRenpyFiles(files);
    const jumpTargets = result.edges
      .filter((e) => e.kind === "jump")
      .map((e) => e.target);

    expect(jumpTargets).toContain("key_route");
    expect(jumpTargets).toContain("no_key_route");
  });

  it("handles keyword arguments in SetVariable and ToggleVariable", async () => {
    const files = [
      {
        name: "kwargs_actions.rpy",
        content: [
          "label start:",
          "    screen kw_screen():",
          '        textbutton "Set Score" action SetVariable(variable="score", value=100)',
          '        textbutton "Toggle Flag" action ToggleVariable(variable="flag", true_value=True, false_value=False)',
        ].join("\n"),
      },
    ];

    const result = await parseRenpyFiles(files);
    expect(result.nodeMutations?.get("start")).toContainEqual(
      expect.objectContaining({
        variableName: "score",
        operator: "=",
        value: 100,
      }),
    );
  });

  it("parses dollar assignments inside init blocks", async () => {
    const files = [
      {
        name: "init_dollar.rpy",
        content: [
          "init 5:",
          '    $ target_label = "dollar_dest"',
          "",
          "label start:",
          "    jump expression target_label",
          "",
          "label dollar_dest:",
          "    $ pass",
        ].join("\n"),
      },
    ];

    const result = await parseRenpyFiles(files);
    expect(result.edges).toContainEqual(
      expect.objectContaining({
        source: "start",
        target: "dollar_dest",
        kind: "jump",
      }),
    );
  });
});
