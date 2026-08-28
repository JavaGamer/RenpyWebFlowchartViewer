import { describe, expect, it } from "vitest";
import { parseRenpyFiles } from "../../src/parser/parser.ts";

describe("Deep Screen & GUI Action Parsing", () => {
  it("extracts screen actions and links call screen statements to target labels", async () => {
    const screensRpy = `
screen city_map:
    imagebutton:
        idle "map_park.png"
        action Jump("park_label")
    imagebutton:
        idle "map_shop.png"
        action [SetVariable("visited_shop", True), Jump("shop_label")]
    textbutton "Help":
        action Call("tutorial_label")
`;

    const scriptRpy = `
label start:
    "Looking at the map."
    call screen city_map

label park_label:
    "You are in the park."
    return

label shop_label:
    "You are in the shop."
    return

label tutorial_label:
    "Tutorial explanation."
    return
`;

    const result = await parseRenpyFiles([
      {
        name: "screens.rpy",
        relativePath: "game/screens.rpy",
        content: screensRpy,
      },
      {
        name: "script.rpy",
        relativePath: "game/script.rpy",
        content: scriptRpy,
      },
    ]);

    const screenCallNode = result.nodes.find((n) => n.type === "SCREEN_CALL");
    expect(screenCallNode).toBeDefined();

    // Verify outgoing jump edges to park_label and shop_label
    const parkEdge = result.edges.find(
      (e) => e.source === screenCallNode!.id && e.target === "park_label",
    );
    expect(parkEdge).toBeDefined();
    expect(parkEdge?.kind).toBe("jump");

    const shopEdge = result.edges.find(
      (e) => e.source === screenCallNode!.id && e.target === "shop_label",
    );
    expect(shopEdge).toBeDefined();
    expect(shopEdge?.kind).toBe("jump");

    // Verify outgoing call edge to tutorial_label
    const tutorialEdge = result.edges.find(
      (e) => e.source === screenCallNode!.id && e.target === "tutorial_label",
    );
    expect(tutorialEdge).toBeDefined();
    expect(tutorialEdge?.kind).toBe("call");

    // Verify screenCallNode recorded mutations from SetVariable action
    expect(screenCallNode?.mutations).toBeDefined();
    expect(
      screenCallNode?.mutations?.some(
        (m) => m.variableName === "visited_shop" && m.operator === "=",
      ),
    ).toBe(true);
  });

  it("handles Return() action, ToggleVariable(), and dynamic call screen expressions", async () => {
    const screensRpy = `
screen confirm_modal:
    textbutton "Yes":
        action [ToggleVariable("sound_enabled"), Return(True)]
`;

    const scriptRpy = `
label start:
    call screen expression "confirm_modal"
    "Control resumed after return."
    return
`;

    const result = await parseRenpyFiles([
      {
        name: "screens.rpy",
        relativePath: "game/screens.rpy",
        content: screensRpy,
      },
      {
        name: "script.rpy",
        relativePath: "game/script.rpy",
        content: scriptRpy,
      },
    ]);

    const screenCallNode = result.nodes.find((n) => n.type === "SCREEN_CALL");
    expect(screenCallNode).toBeDefined();

    // Verify toggle mutation was recorded
    expect(
      screenCallNode?.mutations?.some(
        (m) => m.variableName === "sound_enabled" && m.operator === "toggle",
      ),
    ).toBe(true);

    // Verify return sequence edge back to calling label
    const returnEdge = result.edges.find(
      (e) => e.source === screenCallNode!.id && e.target === "start",
    );
    expect(returnEdge).toBeDefined();
    expect(returnEdge?.kind).toBe("sequence");
    expect(returnEdge?.label).toBe("return");
  });
});
