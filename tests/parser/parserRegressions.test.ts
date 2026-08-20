import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseRenpyFiles } from "../../src/parser/parser.ts";
import { createGraphState } from "../../src/parser/pipelineState.ts";
import { preParseInitialization } from "../../src/parser/initMapper.ts";
import { computeLineIndent } from "../../src/parser/tokenScanStage.ts";
import { extractSceneAsset } from "../../src/parser/handlers/audioCues.ts";
import { PARSER_TOKENS } from "../../src/parser/parserTokens.ts";
import {
  buildConditionalVisibility,
  type FlowEdge,
  type FlowNode,
  simplifyGraph,
} from "../../src/domain/index.ts";

function loadFixture(name: string): string {
  const fixturesDir = resolve(import.meta.dirname, "../fixtures");
  return readFileSync(resolve(fixturesDir, name), "utf8");
}

describe("parseRenpyFiles", () => {
  // ── Fixture-based regression cases ───────────────────────────────────────────

  it("fixture: nested menus preserve menu-option jump edges, including nested options", async () => {
    const result = await parseRenpyFiles([
      { name: "nested-menus.rpy", content: loadFixture("nested-menus.rpy") },
    ]);

    const menuNodes = result.nodes.filter((n) => n.type === "MENU");
    expect(menuNodes).toHaveLength(2);
    expect(menuNodes.map((n) => n.id)).toEqual(["menu_1", "menu_2"]);

    expect(result.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: "start", target: "menu_1" }),
        expect.objectContaining({
          source: "menu_1",
          target: "menu_2",
          label: "Ask about quest",
        }),
      ]),
    );

    const acceptedEdge = result.edges.find((e) =>
      e.target === "accepted" && e.label === "Accept quest"
    );
    const declinedViaNested = result.edges.find((e) =>
      e.target === "declined" && e.label === "Decline quest"
    );
    const declinedDirect = result.edges.find((e) =>
      e.target === "declined" && e.label === "Leave"
    );

    expect(acceptedEdge).toBeDefined();
    expect(declinedViaNested).toBeDefined();
    expect(declinedDirect).toBeDefined();
  });

  it("fixture: unreachable labels are still emitted as nodes and keep normal sequence/jump behavior", async () => {
    const result = await parseRenpyFiles([
      {
        name: "unreachable-labels.rpy",
        content: loadFixture("unreachable-labels.rpy"),
      },
    ]);

    expect(result.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "start", type: "LABEL" }),
        expect.objectContaining({ id: "hidden_branch", type: "LABEL" }),
        expect.objectContaining({ id: "finish", type: "LABEL" }),
      ]),
    );

    expect(result.edges).toContainEqual(
      expect.objectContaining({ source: "start", target: "finish" }),
    );
    expect(result.edges).toContainEqual(
      expect.objectContaining({
        source: "hidden_branch",
        target: "finish",
        label: "next",
      }),
    );
  });

  it("fixture: cyclic jumps are represented as explicit jump edges in both directions", async () => {
    const result = await parseRenpyFiles([
      { name: "cyclic-jumps.rpy", content: loadFixture("cyclic-jumps.rpy") },
    ]);

    expect(result.edges).toContainEqual(
      expect.objectContaining({ source: "loop_a", target: "loop_b" }),
    );
    expect(result.edges).toContainEqual(
      expect.objectContaining({ source: "loop_b", target: "loop_a" }),
    );
  });

  it("fixture: malformed script recovery preserves parsable labels and does not throw", async () => {
    await expect(
      parseRenpyFiles([
        {
          name: "malformed-script-recovery.rpy",
          content: loadFixture("malformed-script-recovery.rpy"),
        },
      ]),
    ).resolves.toEqual(
      expect.objectContaining({
        nodes: expect.arrayContaining([
          expect.objectContaining({ id: "start", type: "LABEL" }),
          expect.objectContaining({ id: "fallback", type: "LABEL" }),
        ]),
        edges: expect.arrayContaining([
          expect.objectContaining({ source: "start", target: "fallback" }),
        ]),
      }),
    );
  });

  it("fixture: extracts direct renpy.jump/renpy.call from python blocks and over-approximates loop/state control flow", async () => {
    const result = await parseRenpyFiles([
      {
        name: "direct-renpy-api.rpy",
        content: loadFixture("direct-renpy-api.rpy"),
      },
    ]);

    expect(result.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "start",
          target: "jump_target",
          kind: "jump",
        }),
        expect.objectContaining({
          source: "start",
          target: "loop_target",
          kind: "jump",
        }),
        expect.objectContaining({
          source: "start",
          target: "call_target",
          kind: "call",
        }),
        expect.objectContaining({
          source: "start",
          target: "next_label",
          kind: "sequence",
          label: "next",
        }),
      ]),
    );
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "dynamic_target",
          severity: "warning",
          location: expect.objectContaining({
            chapter: "direct-renpy-api",
            construct: "renpy.call",
            targetExpression: "dynamic_target",
          }),
        }),
      ]),
    );
  });

  it("does not treat non-direct identifiers like myrenpy.call as direct renpy API calls", async () => {
    const script = [
      "label start:",
      "    python:",
      '        myrenpy.call("target")',
      "",
      "label target:",
      '    "target"',
      "",
    ].join("\n");
    const result = await parseRenpyFiles([{
      name: "not-direct-renpy.rpy",
      content: script,
    }]);
    expect(
      result.edges.find((e) =>
        e.kind === "call" && e.source === "start" && e.target === "target"
      ),
    ).toBeUndefined();
  });

  it("fixture: extracts direct screen action Jump/Call targets and warns on dynamic action targets", async () => {
    const result = await parseRenpyFiles([
      {
        name: "direct-screen-actions.rpy",
        content: loadFixture("direct-screen-actions.rpy"),
      },
    ]);

    expect(result.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "start",
          target: "jump_target",
          kind: "jump",
        }),
        expect.objectContaining({
          source: "start",
          target: "call_target",
          kind: "call",
        }),
      ]),
    );
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "dynamic_target",
          severity: "warning",
          location: expect.objectContaining({
            chapter: "direct-screen-actions",
            construct: "Jump",
            targetExpression: "dynamic_target",
          }),
        }),
      ]),
    );
  });

  it("extracts timer-driven screen actions as timeout-aware jump/call edges", async () => {
    const result = await parseRenpyFiles([
      {
        name: "timer-screen-actions.rpy",
        content: loadFixture("timer-screen-actions.rpy"),
      },
    ]);

    expect(result.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "start",
          target: "too_late",
          kind: "jump",
          timeout: { isTimeout: true, durationSeconds: 5 },
        }),
        expect.objectContaining({
          source: "start",
          target: "helper",
          kind: "call",
          timeout: { isTimeout: true, durationSeconds: 3 },
        }),
        expect.objectContaining({
          source: "start",
          target: "block_timeout_target",
          kind: "jump",
          timeout: { isTimeout: true, durationSeconds: 6.5 },
        }),
      ]),
    );
  });

  it("marks nested and assignment timer screen actions as timeout edges", async () => {
    const result = await parseRenpyFiles([
      {
        name: "timer-screen-actions.rpy",
        content: loadFixture("timer-screen-actions.rpy"),
      },
    ]);

    expect(result.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "start",
          target: "skip_target",
          kind: "jump",
          timeout: { isTimeout: true, durationSeconds: 7 },
        }),
        expect.objectContaining({
          source: "start",
          target: "helper_two",
          kind: "call",
          timeout: { isTimeout: true, durationSeconds: 2 },
        }),
      ]),
    );
  });

  it("warns on dynamic timer screen action targets without emitting unresolved timer edges", async () => {
    const result = await parseRenpyFiles([
      {
        name: "timer-screen-actions.rpy",
        content: loadFixture("timer-screen-actions.rpy"),
      },
    ]);

    expect(result.edges.find((edge) => edge.target === "dynamic_target"))
      .toBeUndefined();
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "dynamic_target",
          severity: "warning",
          location: expect.objectContaining({
            chapter: "timer-screen-actions",
            construct: "Jump",
            targetExpression: "dynamic_target",
          }),
        }),
      ]),
    );
  });

  it("ignores top-level python blocks that are outside any active label scope", async () => {
    const script = [
      "python:",
      '    renpy.call("helper")',
      "",
      "label start:",
      '    "hello"',
      "",
      "label helper:",
      "    return",
      "",
    ].join("\n");

    const result = await parseRenpyFiles([{
      name: "global-python.rpy",
      content: script,
    }]);

    expect(result.edges.find((e) => e.kind === "call" && e.target === "helper"))
      .toBeUndefined();
  });

  it("ignores top-level screen blocks instead of attributing them to the previous label", async () => {
    const script = [
      "label start:",
      '    "hello"',
      "",
      "screen chooser():",
      '    textbutton "Go" action Jump("dest")',
      "",
      "label dest:",
      "    return",
      "",
    ].join("\n");

    const result = await parseRenpyFiles([{
      name: "global-screen.rpy",
      content: script,
    }]);

    expect(
      result.edges.find((e) =>
        e.kind === "jump" && e.source === "start" && e.target === "dest"
      ),
    ).toBeUndefined();
    expect(result.edges).toContainEqual(
      expect.objectContaining({
        source: "start",
        target: "dest",
        kind: "sequence",
        label: "next",
      }),
    );
  });

  it("does not synthesize action edges from a reused global screen for whichever label was parsed last", async () => {
    const script = [
      "label first:",
      "    show screen chooser",
      "",
      "label second:",
      "    show screen chooser",
      "",
      "screen chooser():",
      '    textbutton "Go" action Call("dest")',
      "",
      "label dest:",
      "    return",
      "",
    ].join("\n");

    const result = await parseRenpyFiles([{
      name: "reused-global-screen.rpy",
      content: script,
    }]);

    expect(result.edges.find((e) => e.kind === "call" && e.target === "dest"))
      .toBeUndefined();
  });

  it("extracts ST variant default action rules", async () => {
    const script = [
      "label start:",
      "    screen route_picker():",
      '        textbutton "Route" action timedchoice("route_one")',
      '        textbutton "Title" action title("title_screen")',
      "",
      "label route_one:",
      "    return",
      "",
      "label title_screen:",
      "    return",
      "",
    ].join("\n");

    const result = await parseRenpyFiles([{
      name: "st-defaults.rpy",
      content: script,
    }], { parserVariant: "st" });

    expect(result.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "start",
          target: "route_one",
          kind: "call",
        }),
        expect.objectContaining({
          source: "start",
          target: "title_screen",
          kind: "jump",
        }),
      ]),
    );
  });

  it("applies custom screen action rules on top of defaults", async () => {
    const script = [
      "label start:",
      "    screen route_picker():",
      '        textbutton "Route" action Warp("warp_target")',
      "",
      "label warp_target:",
      "    return",
      "",
    ].join("\n");

    const result = await parseRenpyFiles(
      [{ name: "custom-screen-rule.rpy", content: script }],
      {
        parserVariant: "renpy",
        screenActionRules: [{ actionName: "Warp", actionKind: "jump" }],
      },
    );

    expect(result.edges).toContainEqual(
      expect.objectContaining({
        source: "start",
        target: "warp_target",
        kind: "jump",
      }),
    );
  });

  it("warns instead of inferring dynamic ST variant action targets", async () => {
    const script = [
      "label start:",
      "    screen route_picker():",
      '        textbutton "Route" action timedchoice(dynamic_target)',
      "",
      "label route_one:",
      "    return",
      "",
    ].join("\n");

    const result = await parseRenpyFiles([{
      name: "st-dynamic-target.rpy",
      content: script,
    }], { parserVariant: "st" });

    expect(result.edges.find((edge) => edge.target === "dynamic_target"))
      .toBeUndefined();
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "dynamic_target",
          severity: "warning",
          location: expect.objectContaining({
            chapter: "st-dynamic-target",
            construct: "timedchoice",
            targetExpression: "dynamic_target",
          }),
        }),
      ]),
    );
  });

  it("extracts direct renpy.jump/renpy.call targets when extra arguments are present", async () => {
    const script = [
      "label start:",
      "    python:",
      '        renpy.jump("jump_target", from_current=True)',
      '        renpy.call("call_target", from_current=True)',
      "",
      "label jump_target:",
      "    return",
      "",
      "label call_target:",
      "    return",
      "",
    ].join("\n");

    const result = await parseRenpyFiles([{
      name: "renpy-extra-args.rpy",
      content: script,
    }]);

    expect(result.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "start",
          target: "jump_target",
          kind: "jump",
        }),
        expect.objectContaining({
          source: "start",
          target: "call_target",
          kind: "call",
        }),
      ]),
    );
    expect(
      (result.diagnostics ?? []).some((d) =>
        d.location?.chapter === "renpy-extra-args" &&
        (d.location?.construct === "renpy.jump" ||
          d.location?.construct === "renpy.call")
      ),
    ).toBe(false);
  });

  it("extracts direct renpy.jump/renpy.call targets when target keyword is not first argument", async () => {
    const script = [
      "label start:",
      "    python:",
      '        renpy.jump(from_current=True, label="jump_target")',
      '        renpy.call(from_current=True, label="call_target")',
      "",
      "label jump_target:",
      "    return",
      "",
      "label call_target:",
      "    return",
      "",
    ].join("\n");

    const result = await parseRenpyFiles([{
      name: "renpy-keyword-order.rpy",
      content: script,
    }]);

    expect(result.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "start",
          target: "jump_target",
          kind: "jump",
        }),
        expect.objectContaining({
          source: "start",
          target: "call_target",
          kind: "call",
        }),
      ]),
    );
    expect(
      (result.diagnostics ?? []).some((d) =>
        d.location?.chapter === "renpy-keyword-order" &&
        (d.location?.construct === "renpy.jump" ||
          d.location?.construct === "renpy.call")
      ),
    ).toBe(false);
  });

  it("extracts direct renpy api targets with explicit backslash multiline continuation and inline comments", async () => {
    const script = [
      "label start:",
      "    python:",
      '        renpy.jump("jump_target", \\',
      "            from_current=True)  # comment with ) , : tokens",
      '        renpy.call(label="call_target", \\',
      "            from_current=True)  # trailing ) , : in comment",
      "",
      "label jump_target:",
      "    return",
      "",
      "label call_target:",
      "    return",
      "",
    ].join("\n");

    const result = await parseRenpyFiles([{
      name: "renpy-multiline-backslash.rpy",
      content: script,
    }]);

    expect(result.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "start",
          target: "jump_target",
          kind: "jump",
        }),
        expect.objectContaining({
          source: "start",
          target: "call_target",
          kind: "call",
        }),
      ]),
    );
    expect(
      (result.diagnostics ?? []).some((d) =>
        d.code === "dynamic_target" &&
        d.location?.chapter === "renpy-multiline-backslash" &&
        (d.location?.construct === "renpy.jump" ||
          d.location?.construct === "renpy.call")
      ),
    ).toBe(false);
  });

  it("extracts direct renpy api targets with implicit grouping multiline continuation and inline comments", async () => {
    const script = [
      "label start:",
      "    python:",
      "        renpy.jump(",
      '            "jump_target",  # comment with ) , : tokens',
      "            from_current=True,",
      "        )",
      "        renpy.call(",
      "            from_current=True,",
      '            label="call_target",  # trailing ) , : in comment',
      "        )",
      "",
      "label jump_target:",
      "    return",
      "",
      "label call_target:",
      "    return",
      "",
    ].join("\n");

    const result = await parseRenpyFiles([{
      name: "renpy-multiline-grouping.rpy",
      content: script,
    }]);

    expect(result.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "start",
          target: "jump_target",
          kind: "jump",
        }),
        expect.objectContaining({
          source: "start",
          target: "call_target",
          kind: "call",
        }),
      ]),
    );
    expect(
      (result.diagnostics ?? []).some((d) =>
        d.code === "dynamic_target" &&
        d.location?.chapter === "renpy-multiline-grouping" &&
        (d.location?.construct === "renpy.jump" ||
          d.location?.construct === "renpy.call")
      ),
    ).toBe(false);
  });

  it("extracts direct screen action targets with keyword and trailing arguments", async () => {
    const script = [
      "label start:",
      "    screen nav_overlay:",
      '        textbutton "Jump A" action Jump("jump_target", from_current=True)',
      '        textbutton "Call B" action Call(label="call_target")',
      "",
      "label jump_target:",
      "    return",
      "",
      "label call_target:",
      "    return",
      "",
    ].join("\n");

    const result = await parseRenpyFiles([{
      name: "screen-extra-args.rpy",
      content: script,
    }]);

    expect(result.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "start",
          target: "jump_target",
          kind: "jump",
        }),
        expect.objectContaining({
          source: "start",
          target: "call_target",
          kind: "call",
        }),
      ]),
    );
    expect(
      (result.diagnostics ?? []).some((d) =>
        d.location?.chapter === "screen-extra-args" &&
        (d.location?.construct === "Jump" ||
          d.location?.construct === "Call")
      ),
    ).toBe(false);
  });

  it("extracts direct screen action targets when action uses assignment syntax", async () => {
    const script = [
      "label start:",
      "    screen nav_overlay:",
      '        textbutton "Jump A" action=Jump("jump_target")',
      '        textbutton "Call B" action = Call("call_target")',
      "",
      "label jump_target:",
      "    return",
      "",
      "label call_target:",
      "    return",
      "",
    ].join("\n");

    const result = await parseRenpyFiles([{
      name: "screen-action-assignment.rpy",
      content: script,
    }]);

    expect(result.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "start",
          target: "jump_target",
          kind: "jump",
        }),
        expect.objectContaining({
          source: "start",
          target: "call_target",
          kind: "call",
        }),
      ]),
    );
  });

  it("extracts multiple screen actions from action list expressions", async () => {
    const script = [
      "label start:",
      "    screen nav_overlay:",
      '        textbutton "Jump A" action [Jump("jump_target"), Call("call_target")]',
      "",
      "label jump_target:",
      "    return",
      "",
      "label call_target:",
      "    return",
      "",
    ].join("\n");

    const result = await parseRenpyFiles([{
      name: "screen-action-list.rpy",
      content: script,
    }]);

    expect(result.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "start",
          target: "jump_target",
          kind: "jump",
        }),
        expect.objectContaining({
          source: "start",
          target: "call_target",
          kind: "call",
        }),
      ]),
    );
  });

  it("extracts nested screen actions from composite conditional action expressions", async () => {
    const script = [
      "label start:",
      "    screen nav_overlay:",
      '        textbutton "Go" action If(seen_intro, [Jump("jump_target"), NullAction()], (Call("call_target"),))',
      "",
      "label jump_target:",
      "    return",
      "",
      "label call_target:",
      "    return",
      "",
    ].join("\n");

    const result = await parseRenpyFiles([{
      name: "screen-action-nested-composite.rpy",
      content: script,
    }]);

    expect(result.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "start",
          target: "jump_target",
          kind: "jump",
        }),
        expect.objectContaining({
          source: "start",
          target: "call_target",
          kind: "call",
        }),
      ]),
    );
  });

  it("extracts nested screen actions from keyword action payloads", async () => {
    const script = [
      "label start:",
      "    screen nav_overlay:",
      '        textbutton "Go" action SelectedIf(seen_intro, yes=Jump("jump_target"), no=[NullAction(), Call("call_target")])',
      "",
      "label jump_target:",
      "    return",
      "",
      "label call_target:",
      "    return",
      "",
    ].join("\n");

    const result = await parseRenpyFiles([{
      name: "screen-action-keyword-payloads.rpy",
      content: script,
    }]);

    expect(result.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "start",
          target: "jump_target",
          kind: "jump",
        }),
        expect.objectContaining({
          source: "start",
          target: "call_target",
          kind: "call",
        }),
      ]),
    );
  });

  it("extracts nested screen actions from multiline If/SelectedIf payloads with inline comments", async () => {
    const script = [
      "label start:",
      "    screen nav_overlay:",
      '        textbutton "Go If" action If(',
      "            seen_intro,  # comment with ) , :",
      "            [",
      '                Jump("jump_target"),',
      "                NullAction(),  # comment with ) , :",
      "            ],",
      "            (",
      '                Call("call_target"),',
      "            ),",
      "        )",
      '        textbutton "Go SelectedIf" action SelectedIf(',
      "            seen_intro,  # comment with ) , :",
      '            yes=Jump("jump_target"),',
      "            no=[",
      "                NullAction(),",
      '                Call("call_target"),  # comment with ) , :',
      "            ],",
      "        )",
      "",
      "label jump_target:",
      "    return",
      "",
      "label call_target:",
      "    return",
      "",
    ].join("\n");

    const result = await parseRenpyFiles([{
      name: "screen-action-multiline-comments.rpy",
      content: script,
    }]);

    expect(result.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "start",
          target: "jump_target",
          kind: "jump",
        }),
        expect.objectContaining({
          source: "start",
          target: "call_target",
          kind: "call",
        }),
      ]),
    );
    expect(
      (result.diagnostics ?? []).some((d) =>
        d.code === "dynamic_target" &&
        d.location?.chapter === "screen-action-multiline-comments" &&
        (d.location?.construct === "Jump" ||
          d.location?.construct === "Call")
      ),
    ).toBe(false);
  });

  it("applies custom screen action rules inside nested action structures", async () => {
    const script = [
      "label start:",
      "    screen route_picker():",
      '        textbutton "Route" action If(can_warp, [Warp("warp_target")], NullAction())',
      "",
      "label warp_target:",
      "    return",
      "",
    ].join("\n");

    const result = await parseRenpyFiles(
      [{ name: "nested-custom-screen-rule.rpy", content: script }],
      {
        parserVariant: "renpy",
        screenActionRules: [{ actionName: "Warp", actionKind: "jump" }],
      },
    );

    expect(result.edges).toContainEqual(
      expect.objectContaining({
        source: "start",
        target: "warp_target",
        kind: "jump",
      }),
    );
  });

  it("warns on dynamic nested screen action targets", async () => {
    const script = [
      "label start:",
      "    screen nav_overlay:",
      '        textbutton "Go" action If(can_jump, Jump(dynamic_target), NullAction())',
      "",
      "label jump_target:",
      "    return",
      "",
    ].join("\n");

    const result = await parseRenpyFiles([{
      name: "nested-dynamic-screen-target.rpy",
      content: script,
    }]);

    expect(result.edges.find((edge) => edge.target === "dynamic_target"))
      .toBeUndefined();
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "dynamic_target",
          severity: "warning",
          location: expect.objectContaining({
            chapter: "nested-dynamic-screen-target",
            construct: "Jump",
            targetExpression: "dynamic_target",
          }),
        }),
      ]),
    );
  });

  it("does not recurse into nested calls for non-wrapper screen actions", async () => {
    const script = [
      "label start:",
      "    screen nav_overlay:",
      '        textbutton "Go" action Function(handler, Jump("jump_target"), Call("call_target"))',
      "",
      "label jump_target:",
      "    return",
      "",
      "label call_target:",
      "    return",
      "",
    ].join("\n");

    const result = await parseRenpyFiles([{
      name: "screen-non-wrapper-nested-calls.rpy",
      content: script,
    }]);

    expect(
      result.edges.find((edge) =>
        edge.kind === "jump" && edge.target === "jump_target"
      ),
    ).toBeUndefined();
    expect(
      result.edges.find((edge) =>
        edge.kind === "call" && edge.target === "call_target"
      ),
    ).toBeUndefined();
  });

  it("does not infer navigation edges from non-action screen expressions", async () => {
    const script = [
      "label start:",
      "    screen nav_overlay:",
      '        default preview_jump = Jump("jump_target")',
      '        default preview_call = Call("call_target")',
      '        textbutton "Hover" hovered Jump("hover_target")',
      '        textbutton "Actual" action NullAction()',
      "",
      "label jump_target:",
      "    return",
      "",
      "label call_target:",
      "    return",
      "",
      "label hover_target:",
      "    return",
      "",
    ].join("\n");

    const result = await parseRenpyFiles([{
      name: "screen-non-action-expressions.rpy",
      content: script,
    }]);

    expect(
      result.edges.find((edge) =>
        edge.kind === "jump" && edge.target === "jump_target"
      ),
    ).toBeUndefined();
    expect(
      result.edges.find((edge) =>
        edge.kind === "call" && edge.target === "call_target"
      ),
    ).toBeUndefined();
    expect(
      result.edges.find((edge) =>
        edge.kind === "jump" && edge.target === "hover_target"
      ),
    ).toBeUndefined();
  });

  it("does not root navigation extraction from nested action keywords in unrelated screen expressions", async () => {
    const script = [
      "label start:",
      "    screen nav_overlay:",
      '        default cfg = ButtonConfig(action=Jump("jump_target"))',
      '        textbutton "Actual" action NullAction()',
      "",
      "label jump_target:",
      "    return",
      "",
    ].join("\n");

    const result = await parseRenpyFiles([{
      name: "screen-nested-action-keyword.rpy",
      content: script,
    }]);

    expect(
      result.edges.find((edge) =>
        edge.kind === "jump" && edge.target === "jump_target"
      ),
    ).toBeUndefined();
  });

  it("extracts direct renpy.jump/renpy.call targets from non-f-string prefixed literals", async () => {
    const script = [
      "label start:",
      "    python:",
      '        renpy.jump(u"jump_target")',
      '        renpy.call(r"call_target")',
      "",
      "label jump_target:",
      "    return",
      "",
      "label call_target:",
      "    return",
      "",
    ].join("\n");

    const result = await parseRenpyFiles([{
      name: "renpy-prefixed-literals.rpy",
      content: script,
    }]);

    expect(result.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "start",
          target: "jump_target",
          kind: "jump",
        }),
        expect.objectContaining({
          source: "start",
          target: "call_target",
          kind: "call",
        }),
      ]),
    );
  });

  it("extracts direct renpy api targets from legacy unicode-raw prefixed literals", async () => {
    const script = [
      "label start:",
      "    python:",
      '        renpy.jump(ur"jump_target")',
      '        renpy.call(ru"call_target")',
      "",
      "label jump_target:",
      "    return",
      "",
      "label call_target:",
      "    return",
      "",
    ].join("\n");

    const result = await parseRenpyFiles([{
      name: "renpy-legacy-unicode-raw-prefixes.rpy",
      content: script,
    }]);

    expect(result.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "start",
          target: "jump_target",
          kind: "jump",
        }),
        expect.objectContaining({
          source: "start",
          target: "call_target",
          kind: "call",
        }),
      ]),
    );
  });

  it("uses the latest earlier same-label python assignment for direct renpy api targets", async () => {
    const script = [
      "label start:",
      "    python:",
      '        route = "first_target"',
      '        route = "second_target"',
      "        renpy.jump(route)",
      "",
      "label first_target:",
      "    return",
      "",
      "label second_target:",
      "    return",
      "",
    ].join("\n");

    const result = await parseRenpyFiles([{
      name: "latest-assignment.rpy",
      content: script,
    }]);

    expect(result.edges).toContainEqual(
      expect.objectContaining({
        source: "start",
        target: "second_target",
        kind: "jump",
      }),
    );
    expect(
      result.edges.find((edge) =>
        edge.source === "start" && edge.target === "first_target" &&
        edge.kind === "jump"
      ),
    ).toBeUndefined();
    expect(
      (result.diagnostics ?? []).some((d) =>
        d.code === "dynamic_target" &&
        d.location?.construct === "renpy.jump"
      ),
    ).toBe(false);
  });

  it("resolves typed python assignments for jump expression and screen action calls", async () => {
    const script = [
      "label start:",
      "    python:",
      '        jump_target: str = "jump_dest"',
      '        call_target: str = "call_dest"',
      "    jump expression jump_target",
      "    screen nav_overlay:",
      '        textbutton "Go Jump" action Jump(jump_target)',
      '        textbutton "Go Call" action Call(call_target)',
      "",
      "label jump_dest:",
      "    return",
      "",
      "label call_dest:",
      "    return",
      "",
    ].join("\n");

    const result = await parseRenpyFiles([{
      name: "typed-targets.rpy",
      content: script,
    }]);

    expect(result.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "start",
          target: "jump_dest",
          kind: "jump",
        }),
        expect.objectContaining({
          source: "start",
          target: "call_dest",
          kind: "call",
        }),
      ]),
    );
    expect(
      (result.diagnostics ?? []).some((d) =>
        d.code === "dynamic_target" &&
        (d.location?.construct === "jump expression" ||
          d.location?.construct === "Jump" ||
          d.location?.construct === "Call")
      ),
    ).toBe(false);
  });

  it("invalidates same-label python assignment bindings after a dynamic reassignment", async () => {
    const script = [
      "label start:",
      "    python:",
      '        target = "resolved_dest"',
      "        target = compute_target()",
      "        renpy.call(target)",
      "",
      "label resolved_dest:",
      "    return",
      "",
    ].join("\n");

    const result = await parseRenpyFiles([{
      name: "dynamic-reassign.rpy",
      content: script,
    }]);

    expect(
      result.edges.find((edge) =>
        edge.kind === "call" && edge.source === "start" &&
        edge.target === "resolved_dest"
      ),
    ).toBeUndefined();
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "dynamic_target",
          location: expect.objectContaining({
            construct: "renpy.call",
            targetExpression: "target",
          }),
        }),
      ]),
    );
  });

  it("does not leak same-label python assignment bindings into later labels", async () => {
    const script = [
      "label start:",
      "    python:",
      '        route = "start_dest"',
      "    return",
      "",
      "label second:",
      "    python:",
      "        renpy.jump(route)",
      "",
      "label start_dest:",
      "    return",
      "",
    ].join("\n");

    const result = await parseRenpyFiles([{
      name: "no-cross-label-leak.rpy",
      content: script,
    }]);

    expect(
      result.edges.find((edge) =>
        edge.kind === "jump" && edge.source === "second" &&
        edge.target === "start_dest"
      ),
    ).toBeUndefined();
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "dynamic_target",
          location: expect.objectContaining({
            construct: "renpy.jump",
            targetExpression: "route",
          }),
        }),
      ]),
    );
  });

  it("ignores direct call-like patterns inside comments and quoted strings", async () => {
    const script = [
      "label start:",
      "    python:",
      '        "renpy.call(\\"string_target\\")"',
      '        # renpy.jump("comment_target")',
      "    show screen fake_overlay",
      "",
      "screen fake_overlay:",
      '    text "action Jump(\\"text_target\\")"',
      '    # textbutton "Call target" action Call("comment_call_target")',
      "",
      "label end:",
      "    return",
      "",
    ].join("\n");

    const result = await parseRenpyFiles([{
      name: "ignored-direct-call-patterns.rpy",
      content: script,
    }]);
    const ignoredTargets = new Set([
      "string_target",
      "comment_target",
      "text_target",
      "comment_call_target",
    ]);
    expect(result.edges.some((edge) => ignoredTargets.has(edge.target))).toBe(
      false,
    );
    expect(
      (result.diagnostics ?? []).some((d) =>
        d.location?.chapter === "ignored-direct-call-patterns" &&
        (d.location?.construct === "renpy.jump" ||
          d.location?.construct === "renpy.call" ||
          d.location?.construct === "Jump" ||
          d.location?.construct === "Call")
      ),
    ).toBe(false);
  });

  it("handles complex conditional nested menu and mixed call/jump flow", async () => {
    const script = [
      "label start:",
      "    if seen_intro:",
      "        menu:",
      '            "Ask mentor":',
      "                call mentor_scene",
      '            "Skip":',
      "                jump end",
      '    "continue"',
      "",
      "label mentor_scene:",
      '    "mentor line"',
      "    return",
      "",
      "label end:",
      '    "done"',
      "",
    ].join("\n");

    const result = await parseRenpyFiles([{
      name: "complex.rpy",
      content: script,
    }]);

    expect(result.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "call", target: "mentor_scene" }),
        expect.objectContaining({ kind: "jump", target: "end" }),
        expect.objectContaining({
          source: "start",
          target: "mentor_scene",
          kind: "sequence",
          label: "next",
        }),
      ]),
    );
  });

  it("classifies helper labels as utility when called directly and returning", async () => {
    const script = [
      "label start:",
      "    call helper",
      "    jump end",
      "",
      "label helper:",
      '    "assist"',
      "    return",
      "",
      "label end:",
      '    "done"',
      "",
    ].join("\n");

    const result = await parseRenpyFiles([{
      name: "utility-role.rpy",
      content: script,
    }]);
    const helper = result.nodes.find((n) => n.id === "helper");
    expect(helper?.role).toBe("utility");
  });

  it("marks terminal story labels for end-of-route badge rendering", async () => {
    const script = [
      "label start:",
      "    jump ending",
      "",
      "label ending:",
      '    "The End"',
      "",
    ].join("\n");

    const result = await parseRenpyFiles([{
      name: "terminal-outcome.rpy",
      content: script,
    }]);
    const start = result.nodes.find((n) => n.id === "start");
    const ending = result.nodes.find((n) => n.id === "ending");
    expect(start?.isTerminalOutcome).toBe(false);
    expect(ending?.isTerminalOutcome).toBe(true);
  });

  it("keeps duplicate labels visible as shadowed nodes and emits warnings", async () => {
    const result = await parseRenpyFiles([
      {
        name: "chapter_one.rpy",
        content: ["label same:", '    "one"', ""].join("\n"),
      },
      {
        name: "chapter_two.rpy",
        content: ["label same:", '    "two"', ""].join("\n"),
      },
    ]);

    const same = result.nodes.find((n) => n.id === "same");
    const shadow = result.nodes.find((n) => n.id === "same__shadow_2");
    expect(same).toBeDefined();
    expect(same?.chapter).toBe("chapter_one");
    expect(same?.dialogueCount).toBe(1);
    expect(shadow).toBeDefined();
    expect(shadow?.chapter).toBe("chapter_two");
    expect(shadow?.dialogueCount).toBe(1);
    expect(shadow?.isShadowed).toBe(true);
    expect(shadow?.shadowOfId).toBe("same");
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "shadowed_label",
          context: expect.objectContaining({ category: "shadowed_label" }),
          location: expect.objectContaining({
            sourceId: "same__shadow_2",
            targetId: "same",
          }),
        }),
      ]),
    );
  });

  it("uses relative paths to keep duplicate basenames distinct and deterministically ordered", async () => {
    const progressFiles: string[] = [];
    const result = await parseRenpyFiles(
      [
        {
          name: "script.rpy",
          relativePath: "routes/beta/script.rpy",
          content: ["label same:", '    "beta"', ""].join("\n"),
        },
        {
          name: "script.rpy",
          relativePath: "routes/alpha/script.rpy",
          content: ["label same:", '    "alpha"', ""].join("\n"),
        },
      ],
      {
        onProgress: (progress) => {
          progressFiles.push(progress.currentFile);
        },
      },
    );

    const same = result.nodes.find((n) => n.id === "same");
    const shadow = result.nodes.find((n) => n.id === "same__shadow_2");
    expect(same?.chapter).toBe("routes/alpha/script");
    expect(same?.dialogueCount).toBe(1);
    expect(shadow?.chapter).toBe("routes/beta/script");
    expect(shadow?.dialogueCount).toBe(1);
    expect(progressFiles).toEqual([
      "routes/alpha/script.rpy",
      "routes/beta/script.rpy",
    ]);
  });

  it("warns when jump/call targets resolve through shadowed duplicate labels", async () => {
    const result = await parseRenpyFiles([
      {
        name: "a.rpy",
        content: ["label start:", "    jump same", ""].join("\n"),
      },
      {
        name: "b.rpy",
        content: ["label helper:", "    call same", ""].join("\n"),
      },
      {
        name: "c.rpy",
        content: ["label same:", "    return", ""].join("\n"),
      },
      {
        name: "d.rpy",
        content: ["label same:", "    return", ""].join("\n"),
      },
    ]);

    expect(result.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "start",
          target: "same",
          kind: "jump",
        }),
        expect.objectContaining({
          source: "helper",
          target: "same",
          kind: "call",
        }),
      ]),
    );
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "shadowed_label",
          context: expect.objectContaining({
            category: "shadowed_target_resolution",
          }),
          location: expect.objectContaining({
            sourceId: "start",
            targetId: "same",
          }),
        }),
        expect.objectContaining({
          code: "shadowed_label",
          context: expect.objectContaining({
            category: "shadowed_target_resolution",
          }),
          location: expect.objectContaining({
            sourceId: "helper",
            targetId: "same",
          }),
        }),
      ]),
    );
  });

  it("resolves jumps to labels that are defined in a different file", async () => {
    const result = await parseRenpyFiles([
      {
        name: "part-a.rpy",
        content: ["label intro:", "    jump ending", ""].join("\n"),
      },
      {
        name: "part-b.rpy",
        content: ["label ending:", '    "done"', ""].join("\n"),
      },
    ]);

    expect(result.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "intro", type: "LABEL" }),
        expect.objectContaining({ id: "ending", type: "LABEL" }),
      ]),
    );
    expect(result.edges).toContainEqual(
      expect.objectContaining({ source: "intro", target: "ending" }),
    );
  });

  it("emits unresolved-target warnings for edges targeting missing labels", async () => {
    const result = await parseRenpyFiles([
      {
        name: "missing-target.rpy",
        content: ["label intro:", "    jump missing_label", ""].join("\n"),
      },
    ]);

    expect(result.edges).toContainEqual(
      expect.objectContaining({
        source: "intro",
        target: "missing_label",
        kind: "jump",
      }),
    );
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "unresolved_target",
          severity: "warning",
          location: expect.objectContaining({
            sourceId: "intro",
            targetId: "missing_label",
          }),
        }),
      ]),
    );
  });

  it("preserves output semantics when tokenization is parallelized", async () => {
    const files = [
      {
        name: "chapter_one.rpy",
        content: ["label same:", '    "one"', "", "label a:", "    jump z", ""]
          .join("\n"),
      },
      {
        name: "chapter_two.rpy",
        content: ["label same:", '    "two"', "", "label z:", "    return", ""]
          .join("\n"),
      },
      {
        name: "chapter_three.rpy",
        content: ["label k:", "    call z", "", "label end:", '    "done"', ""]
          .join("\n"),
      },
    ];

    const sequential = await parseRenpyFiles(files);
    const parallel = await parseRenpyFiles(files, { maxParallelFiles: 3 });

    expect(parallel).toEqual(sequential);
  });

  // ── Triple-quoted string handling regression tests ─────────────────────────────

  it("extracts renpy.call target from triple-quoted string argument", async () => {
    const script = [
      "label start:",
      "    python:",
      '        renpy.call("""call_target""")',
      "",
      "label call_target:",
      "    return",
      "",
    ].join("\n");
    const result = await parseRenpyFiles([{
      name: "triple-q-call.rpy",
      content: script,
    }]);
    expect(result.edges).toContainEqual(
      expect.objectContaining({
        source: "start",
        target: "call_target",
        kind: "call",
      }),
    );
  });

  it("extracts renpy.jump target from triple-quoted string with inner parens", async () => {
    const script = [
      "label start:",
      "    python:",
      '        renpy.jump("""target_with_(parens)""")',
      "",
      "label next:",
      "    return",
      "",
    ].join("\n");
    const result = await parseRenpyFiles([{
      name: "triple-q-parens.rpy",
      content: script,
    }]);
    expect(result.edges).toContainEqual(
      expect.objectContaining({
        source: "start",
        target: "target_with_(parens)",
        kind: "jump",
      }),
    );
  });

  it("splits arguments correctly when triple-quoted string contains a comma", async () => {
    const script = [
      "label start:",
      "    python:",
      '        renpy.call("""a,b""", from_current=True)',
      "",
      "label next:",
      "    return",
      "",
    ].join("\n");
    const result = await parseRenpyFiles([{
      name: "triple-q-comma.rpy",
      content: script,
    }]);
    expect(result.edges).toContainEqual(
      expect.objectContaining({ source: "start", target: "a,b", kind: "call" }),
    );
  });

  it("resolves keyword arg with triple-quoted value containing equals sign", async () => {
    const script = [
      "label start:",
      "    python:",
      "        renpy.jump(label='''x=y''')",
      "",
      "label next:",
      "    return",
      "",
    ].join("\n");
    const result = await parseRenpyFiles([{
      name: "triple-q-eq.rpy",
      content: script,
    }]);
    expect(result.edges).toContainEqual(
      expect.objectContaining({ source: "start", target: "x=y", kind: "jump" }),
    );
  });

  it("handles triple-quoted string with inner quotes and parens in renpy.call", async () => {
    const script = [
      "label start:",
      "    python:",
      '        renpy.call("""label("x")""")',
      "",
      "label next:",
      "    return",
      "",
    ].join("\n");
    const result = await parseRenpyFiles([{
      name: "triple-q-inner-quotes.rpy",
      content: script,
    }]);
    const callEdge = result.edges.find(
      (e) => e.kind === "call" && e.source === "start",
    );
    expect(callEdge).toBeDefined();
    expect(callEdge?.target).toBe('label("x")');
  });

  // ── Whitespace-only target regression tests ────────────────────────────────────

  it("treats whitespace-only renpy.jump target as dynamic and emits a warning", async () => {
    const script = [
      "label start:",
      "    python:",
      '        renpy.jump(" ")',
      "",
      "label next:",
      "    return",
      "",
    ].join("\n");
    const result = await parseRenpyFiles([{
      name: "whitespace-target.rpy",
      content: script,
    }]);
    const jumpEdge = result.edges.find(
      (e) => e.kind === "jump" && e.source === "start" && e.target === " ",
    );
    expect(jumpEdge).toBeUndefined();
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "dynamic_target",
          location: expect.objectContaining({ construct: "renpy.jump" }),
        }),
      ]),
    );
  });

  it("treats empty-string renpy.call target as dynamic and emits a warning", async () => {
    const script = [
      "label start:",
      "    python:",
      '        renpy.call("")',
      "",
      "label next:",
      "    return",
      "",
    ].join("\n");
    const result = await parseRenpyFiles([{
      name: "empty-target.rpy",
      content: script,
    }]);
    const callEdge = result.edges.find(
      (e) => e.kind === "call" && e.source === "start" && e.target === "",
    );
    expect(callEdge).toBeUndefined();
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "dynamic_target",
          location: expect.objectContaining({ construct: "renpy.call" }),
        }),
      ]),
    );
  });

  // ── Menu fallthrough regression tests ──────────────────────────────────────────

  it("does not add a spurious fallthrough sequence edge from a menu whose options all jump", async () => {
    const script = [
      "label choice:",
      "    menu:",
      '        "Option A":',
      "            jump end_a",
      '        "Option B":',
      "            jump end_b",
      "",
      "label end_a:",
      '    "done a"',
      "",
      "label end_b:",
      '    "done b"',
      "",
    ].join("\n");

    const result = await parseRenpyFiles([{
      name: "menu-no-fallthrough.rpy",
      content: script,
    }]);

    const menuNode = result.nodes.find((n) => n.type === "MENU");
    expect(menuNode).toBeDefined();

    // Jump edges from menu options must be present.
    const menuJumps = result.edges.filter((e) =>
      e.source === menuNode?.id && e.kind === "jump"
    );
    expect(menuJumps).toHaveLength(2);

    // No spurious sequence (fallthrough) edge should be added from the menu
    // to end_a just because it is the label that follows in source order.
    const menuSequences = result.edges.filter(
      (e) => e.source === menuNode?.id && e.kind === "sequence",
    );
    expect(menuSequences).toHaveLength(0);
  });

  // ── f-string literal normalisation regression tests ────────────────────────────

  it("strips f-string prefix and quotes from say-statement dialogue lines", async () => {
    const script = [
      "label start:",
      '    f"Hello {name}!"',
      '    F"Another line"',
      "",
    ].join("\n");

    const result = await parseRenpyFiles([{
      name: "fstring-dialogue.rpy",
      content: script,
    }]);

    const node = result.nodes.find((n) => n.id === "start");
    expect(node).toBeDefined();
    expect(node?.dialogueCount).toBe(2);
    expect(node?.dialogueLines).toEqual(["Hello {name}!", "Another line"]);
  });

  it("strips legacy unicode-raw prefixes from say-statement dialogue lines", async () => {
    const script = [
      "label start:",
      '    ur"Line one"',
      '    ru"Line two"',
      "",
    ].join("\n");

    const result = await parseRenpyFiles([{
      name: "legacy-prefix-dialogue.rpy",
      content: script,
    }]);

    const node = result.nodes.find((n) => n.id === "start");
    expect(node).toBeDefined();
    expect(node?.dialogueCount).toBe(2);
    expect(node?.dialogueLines).toEqual(["Line one", "Line two"]);
  });

  // ── Audio & Asset Cues parsing tests ──────────────────────────────────────────

  it("correctly parses and associates audio and asset cues with the active node", async () => {
    const script = [
      "label start:",
      "    scene bg room with fade",
      '    play music "audio/bgm_chill.ogg" fadein 1.0',
      '    "This is dialogue."',
      '    "Extra dialogue 1."',
      '    "Extra dialogue 2."',
      '    play sound "audio/sfx_ding.wav"',
      '    voice "audio/voice_line_1.mp3"',
      '    "More dialogue."',
      "    stop music fadeout 2.0",
      "    queue music theme_track",
      "    scene bg beach",
      '    "Beach dialogue."',
      "",
    ].join("\n");

    const result = await parseRenpyFiles([{
      name: "audio-asset-cues.rpy",
      content: script,
    }], { sceneSplitDialogueThreshold: 0 });

    const scene1 = result.nodes.find((n) => n.id === "start__scene_1");
    const scene2 = result.nodes.find((n) => n.id === "start__scene_2");

    expect(scene1).toBeDefined();
    expect(scene2).toBeDefined();

    expect(scene1?.audioAssetCues).toEqual([
      expect.objectContaining({
        type: "scene",
        asset: "bg room",
        raw: "scene bg room with fade",
        lineNum: 1,
      }),
      expect.objectContaining({
        type: "play",
        channel: "music",
        asset: "audio/bgm_chill.ogg",
        raw: 'play music "audio/bgm_chill.ogg" fadein 1.0',
        lineNum: 2,
      }),
      expect.objectContaining({
        type: "play",
        channel: "sound",
        asset: "audio/sfx_ding.wav",
        raw: 'play sound "audio/sfx_ding.wav"',
        lineNum: 6,
      }),
      expect.objectContaining({
        type: "voice",
        asset: "audio/voice_line_1.mp3",
        raw: 'voice "audio/voice_line_1.mp3"',
        lineNum: 7,
      }),
      expect.objectContaining({
        type: "stop",
        channel: "music",
        asset: "",
        raw: "stop music fadeout 2.0",
        lineNum: 9,
      }),
      expect.objectContaining({
        type: "queue",
        channel: "music",
        asset: "theme_track",
        raw: "queue music theme_track",
        lineNum: 10,
      }),
    ]);

    expect(scene2?.audioAssetCues).toEqual([
      expect.objectContaining({
        type: "scene",
        asset: "bg beach",
        raw: "scene bg beach",
        lineNum: 11,
      }),
    ]);
  });

  // ── Dollar-Prefixed Python Statements & Dict Target Resolution tests ─────────────────

  it("extracts jumps and assignments from dollar-prefixed single-line Python statements", async () => {
    const script = [
      "label start:",
      '    $ target_label = "dest"',
      "    $ renpy.jump(target_label)",
      "",
      "label dest:",
      "    return",
    ].join("\n");

    const result = await parseRenpyFiles([{
      name: "dollar-statements.rpy",
      content: script,
    }]);

    expect(result.edges).toContainEqual(
      expect.objectContaining({
        source: "start",
        target: "dest",
        kind: "jump",
      }),
    );
    expect(
      (result.diagnostics ?? []).some((d) => d.code === "dynamic_target"),
    ).toBe(false);
  });

  it("resolves static and dynamic dictionary-based targets to single and multiple edges", async () => {
    const script = [
      "label start:",
      '    $ target_map = {"route_a": "target_a", "route_b": "target_b"}',
      '    jump expression target_map["route_a"]',
      "    jump expression target_map[route_var]",
      "",
      "label target_a:",
      "    return",
      "",
      "label target_b:",
      "    return",
    ].join("\n");

    const result = await parseRenpyFiles([{
      name: "dict-targets.rpy",
      content: script,
    }]);

    // Static lookup mapping to target_a
    expect(result.edges).toContainEqual(
      expect.objectContaining({
        source: "start",
        target: "target_a",
        kind: "jump",
      }),
    );
    // Dynamic lookup mapping to all target values in the dict: target_a and target_b
    expect(result.edges).toContainEqual(
      expect.objectContaining({
        source: "start",
        target: "target_b",
        kind: "jump",
      }),
    );
  });

  it("parses triple-quoted strings containing escaped quotes without premature termination", async () => {
    const script = [
      "label start:",
      '    if """test escaped triple quote \\""" inside string""":',
      "        jump target_a",
      "",
      "label target_a:",
      "    return",
    ].join("\n");

    const result = await parseRenpyFiles([{
      name: "triple_quoted_escaped.rpy",
      content: script,
    }]);
    const decisionNode = result.nodes.find((node) => node.type === "DECISION");
    expect(decisionNode).toBeDefined();
    expect(result.edges).toContainEqual(
      expect.objectContaining({
        source: decisionNode?.id,
        target: "target_a",
        kind: "jump",
      }),
    );
  });

  // ── Multi-pass Initialization Mapping tests ─────────────────

  it("resolves variables from python early and prioritized init blocks in the correct priority order", async () => {
    const files = [
      {
        name: "priority_init.rpy",
        content: [
          "init 10 python:",
          '    target_val = "target_high"',
          "",
          "python early:",
          '    target_val = "target_early"',
          "",
          "init -5 python:",
          '    target_val = "target_low"',
        ].join("\n"),
      },
      {
        name: "main.rpy",
        content: [
          "label start:",
          "    jump expression target_val",
          "",
          "label target_high:",
          "    return",
        ].join("\n"),
      },
    ];

    const result = await parseRenpyFiles(files);
    expect(result.edges).toContainEqual(
      expect.objectContaining({
        source: "start",
        target: "target_high",
        kind: "jump",
      }),
    );
  });

  it("supports init offset for local file offset adjustment and priority calculation", async () => {
    const files = [
      {
        name: "offset_file.rpy",
        content: [
          "init offset = 20",
          "init -5 python:",
          '    target_val = "target_offset_fifteen"', // 20 - 5 = 15
        ].join("\n"),
      },
      {
        name: "another_file.rpy",
        content: [
          "init 10 python:",
          '    target_val = "target_ten"', // 10
        ].join("\n"),
      },
      {
        name: "main.rpy",
        content: [
          "label start:",
          "    jump expression target_val",
          "",
          "label target_offset_fifteen:",
          "    return",
        ].join("\n"),
      },
    ];

    const result = await parseRenpyFiles(files);
    // target_val should resolve to "target_offset_fifteen" since priority 15 > 10
    expect(result.edges).toContainEqual(
      expect.objectContaining({
        source: "start",
        target: "target_offset_fifteen",
        kind: "jump",
      }),
    );
  });

  it("resolves variables globally across different files", async () => {
    const files = [
      {
        name: "definitions.rpy",
        content: [
          'define global_target = "dest_label"',
          'default global_dict = {"choice": "dest_label_choice"}',
        ].join("\n"),
      },
      {
        name: "story.rpy",
        content: [
          "label start:",
          "    jump expression global_target",
          '    jump expression global_dict["choice"]',
          "",
          "label dest_label:",
          "    return",
          "",
          "label dest_label_choice:",
          "    return",
        ].join("\n"),
      },
    ];

    const result = await parseRenpyFiles(files);
    expect(result.edges).toContainEqual(
      expect.objectContaining({
        source: "start",
        target: "dest_label",
        kind: "jump",
      }),
    );
    expect(result.edges).toContainEqual(
      expect.objectContaining({
        source: "start",
        target: "dest_label_choice",
        kind: "jump",
      }),
    );
  });

  it("ignores screen calls and does not emit navigation edges", async () => {
    const script = [
      "label start:",
      "    call screen custom_selector",
      "    jump next_label",
      "",
      "label next_label:",
      "    return",
    ].join("\n");

    const result = await parseRenpyFiles([{
      name: "screen_call.rpy",
      content: script,
    }]);
    // Should have jump start -> next_label, but NO call to custom_selector
    expect(result.edges).toContainEqual(
      expect.objectContaining({
        source: "start",
        target: "next_label",
        kind: "jump",
      }),
    );
    expect(result.edges.find((e) => e.target === "custom_selector"))
      .toBeUndefined();
  });

  it("registers character definitions in globalCharacters set", () => {
    const files = [
      {
        name: "init.rpy",
        content: [
          'define e = Character("Eileen")',
          'define character.m = Character("Monica")',
          "init python:",
          "    narrator = Character(None)",
        ].join("\n"),
      },
      {
        name: "main.rpy",
        content: [
          "label start:",
          '    e "Hello!"',
        ].join("\n"),
      },
    ];

    const state = createGraphState();
    preParseInitialization(files, state);
    expect(state.globalCharacters.has("e")).toBe(true);
    expect(state.globalCharacters.has("character.m")).toBe(true);
    expect(state.globalCharacters.has("narrator")).toBe(true);
  });

  it("supports define and default priority correctly", async () => {
    const files = [
      {
        name: "priority_defs.rpy",
        content: [
          'define 10 my_val = "high"',
          'define -5 my_val = "low"',
          'default 20 my_val = "highest"',
          'default my_val = "default_zero"',
        ].join("\n"),
      },
      {
        name: "main.rpy",
        content: [
          "label start:",
          "    jump expression my_val",
          "",
          "label highest:",
          "    return",
        ].join("\n"),
      },
    ];

    const result = await parseRenpyFiles(files);
    expect(result.edges).toContainEqual(
      expect.objectContaining({
        source: "start",
        target: "highest",
        kind: "jump",
      }),
    );
  });

  it("correctly strips comments in triple-quoted strings without mangling", () => {
    const files = [
      {
        name: "triple_comments.rpy",
        content: [
          'define my_val = """',
          "hello # not a comment!",
          '"""',
          "label start:",
          "    jump expression my_val",
          "",
          "label test_label:",
          "    return",
        ].join("\n"),
      },
    ];

    const state = createGraphState();
    preParseInitialization(files, state);
    const resolved = state.globalLabelVariableLiteralTargets.get("my_val");
    expect(resolved).toContain("not a comment!");
  });

  it("handles multiline dictionary declarations with column-0 lines inside python blocks", () => {
    const files = [
      {
        name: "multiline_dict.rpy",
        content: [
          "init python:",
          "    choices = {",
          '        "1": "label1",',
          '"2": "label2"',
          "    }",
        ].join("\n"),
      },
    ];

    const state = createGraphState();
    preParseInitialization(files, state);
    const resolvedDict = state.globalLabelVariableDictTargets.get("choices");
    expect(resolvedDict).toBeDefined();
    expect(resolvedDict?.get("1")).toBe("label1");
    expect(resolvedDict?.get("2")).toBe("label2");
  });

  it("adds a menu fallthrough sequence edge for mixed menus where one option jumps and another option falls through", async () => {
    const script = [
      "label start:",
      "    menu:",
      '        "Deny her.":',
      '            "No."',
      '        "Accept her.":',
      "            jump accept_label",
      "    scene bg school",
      '    "after split trigger"',
      "",
      "label accept_label:",
      '    "accepted"',
      "",
    ].join("\n");

    const result = await parseRenpyFiles([{
      name: "mixed_menu_fallthrough.rpy",
      content: script,
    }], { sceneSplitDialogueThreshold: 0 });

    const menuNode = result.nodes.find((n) => n.type === "MENU");
    expect(menuNode).toBeDefined();

    // 1. Verify the jump edge from the menu
    const jumpEdge = result.edges.find(
      (e) => e.source === menuNode?.id && e.kind === "jump",
    );
    expect(jumpEdge).toBeDefined();
    expect(jumpEdge?.target).toBe("accept_label");

    // 2. Verify the fallthrough sequence edge from the menu to the next scene split
    const fallthroughEdge = result.edges.find(
      (e) => e.source === menuNode?.id && e.kind === "sequence",
    );
    expect(fallthroughEdge).toBeDefined();
    expect(fallthroughEdge?.target).toBe("start__scene_2");
    expect(fallthroughEdge?.label).toBe("next");
  });

  // ── Milestone 2 Bug Fix Regressions ──────────────────────────────────────────

  it("m2-regression: computeLineIndent accurately treats tabs as 8-space tab stops", () => {
    expect(computeLineIndent("    hello")).toBe(4);
    expect(computeLineIndent("\thello")).toBe(8);
    expect(computeLineIndent("  \thello")).toBe(8);
    expect(computeLineIndent("\t    hello")).toBe(12);
    expect(computeLineIndent("\t\thello")).toBe(16);
  });

  it("m2-regression: shadowed label target resolution resolves file-local label before falling back to canonical ID", async () => {
    const files = [
      {
        name: "fileA.rpy",
        content: [
          "label start:",
          '    "Starting in A"',
          "    jump local_label",
          "",
          "label local_label:",
          '    "Local A"',
          "",
        ].join("\n"),
      },
      {
        name: "fileB.rpy",
        content: [
          "label start:",
          '    "Starting in B"',
          "    jump local_label",
          "",
          "label local_label:",
          '    "Local B"',
          "",
        ].join("\n"),
      },
    ];

    const result = await parseRenpyFiles(files);

    // Verify shadowed label local_label__shadow_2 exists
    const localBNode = result.nodes.find((n) =>
      n.id === "local_label__shadow_2"
    );
    expect(localBNode).toBeDefined();

    // Verify jump from start__shadow_2 targets local_label__shadow_2, not canonical local_label
    const jumpFromB = result.edges.find((e) =>
      e.source === "start__shadow_2" && e.kind === "jump"
    );
    expect(jumpFromB).toBeDefined();
    expect(jumpFromB?.target).toBe("local_label__shadow_2");
  });

  it("m2-regression: elif/else branches construct distinct decision contexts without in-place mutation", async () => {
    const script = [
      "label start:",
      "    if flag == 1:",
      '        "One"',
      "    elif flag == 2:",
      '        "Two"',
      "    else:",
      '        "Other"',
      "",
    ].join("\n");

    const result = await parseRenpyFiles([{
      name: "branch.rpy",
      content: script,
    }]);
    const decisionNode = result.nodes.find((n) => n.type === "DECISION");
    expect(decisionNode).toBeDefined();
    expect(decisionNode?.condition?.branchKind).toBe("if");
  });

  it("m2-regression: post-conditional block creates rejoin edge to downstream label/scene statement", async () => {
    const script = [
      "label start:",
      '    "before"',
      "    if check_flag:",
      '        "inside if"',
      "    scene bg space",
      '    "after conditional"',
      "",
    ].join("\n");

    const result = await parseRenpyFiles(
      [{ name: "post_cond_rejoin.rpy", content: script }],
      { sceneSplitDialogueThreshold: 0 },
    );

    const decisionNode = result.nodes.find((n) => n.type === "DECISION");
    expect(decisionNode).toBeDefined();

    const rejoinEdge = result.edges.find(
      (e) =>
        e.source === decisionNode?.id && e.kind === "sequence" &&
        e.target === "start__scene_2",
    );
    expect(rejoinEdge).toBeDefined();
    expect(rejoinEdge?.label).toBe("next");
  });

  it("m2-regression: menu fallthrough is preserved when option jump is conditional", async () => {
    const script = [
      "label start:",
      "    menu:",
      '        "Conditional option":',
      "            if flag:",
      "                jump end_label",
      "",
      "label end_label:",
      '    "end"',
      "",
    ].join("\n");

    const result = await parseRenpyFiles([
      { name: "menu_cond_jump.rpy", content: script },
    ]);

    const menuNode = result.nodes.find((n) => n.type === "MENU");
    expect(menuNode).toBeDefined();

    // Verify conditional jump edge exists from menu
    const jumpEdge = result.edges.find(
      (e) => e.source === menuNode?.id && e.kind === "jump",
    );
    expect(jumpEdge).toBeDefined();
    expect(jumpEdge?.target).toBe("end_label");

    // Fallthrough sequence edge should exist from menuNode because flag condition might be false
    const fallthroughEdge = result.edges.find(
      (e) => e.source === menuNode?.id && e.kind === "sequence",
    );
    expect(fallthroughEdge).toBeDefined();
  });

  it("m2-regression: PARSER_TOKENS includes kwShow and kwHide, and while loops create DECISION nodes", async () => {
    expect(PARSER_TOKENS.kwShow).toBeDefined();
    expect(PARSER_TOKENS.kwHide).toBeDefined();

    const script = [
      "label start:",
      "    while loop_counter > 0:",
      '        "looping"',
      "",
    ].join("\n");

    const result = await parseRenpyFiles([{
      name: "while_loop.rpy",
      content: script,
    }]);
    const whileDecisionNode = result.nodes.find((n) => n.type === "DECISION");
    expect(whileDecisionNode).toBeDefined();
    expect(whileDecisionNode?.label).toContain("while");
  });

  it("m2-regression: extractSceneAsset strips trailing colons from scene statements", () => {
    expect(extractSceneAsset("scene bg room:")).toBe("bg room");
    expect(extractSceneAsset("scene bg room with fade:")).toBe("bg room");
    expect(extractSceneAsset('scene "bg room":')).toBe("bg room");
    expect(extractSceneAsset("scene bg room")).toBe("bg room");
  });

  it("adv-regression: buildConditionalVisibility preserves disconnected cycles", () => {
    const nodes: FlowNode[] = [
      { id: "start", type: "LABEL", label: "start", dialogueCount: 1 },
      { id: "cycle_a", type: "LABEL", label: "cycle_a", dialogueCount: 1 },
      { id: "cycle_b", type: "LABEL", label: "cycle_b", dialogueCount: 1 },
    ];
    const edges: FlowEdge[] = [
      { id: "e1", source: "cycle_a", target: "cycle_b", kind: "sequence" },
      { id: "e2", source: "cycle_b", target: "cycle_a", kind: "sequence" },
    ];

    const result = buildConditionalVisibility({
      nodes,
      edges,
      mockFlags: {},
    });

    expect(result.hiddenNodeIds.has("cycle_a")).toBe(false);
    expect(result.hiddenNodeIds.has("cycle_b")).toBe(false);
  });

  it("adv-regression: collapseLinearChains preserves loop edge for collapsed pure cycle", () => {
    const nodes: FlowNode[] = [
      { id: "loop_a", type: "LABEL", label: "loop_a", dialogueCount: 1 },
      { id: "loop_b", type: "LABEL", label: "loop_b", dialogueCount: 1 },
    ];
    const edges: FlowEdge[] = [
      { id: "e1", source: "loop_a", target: "loop_b", kind: "sequence" },
      { id: "e2", source: "loop_b", target: "loop_a", kind: "sequence" },
    ];

    const result = simplifyGraph(nodes, edges, {
      collapseLinearChains: true,
      inlineUtilities: false,
      inlineDetours: false,
      inlineStateToggles: false,
      inlineEmptyLabels: false,
      inlineDialogueThreshold: 0,
    });
    expect(result.nodes).toHaveLength(1);
    expect(
      result.edges.some((e) => e.source === "loop_a" && e.target === "loop_a"),
    ).toBe(true);
  });
});
