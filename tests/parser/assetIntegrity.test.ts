import { describe, expect, it } from "vitest";
import { parseRenpyFiles } from "../../src/parser/parser.ts";

describe("Asset Integrity Verification", () => {
  it("emits missing_asset warnings when project media files are provided and asset is missing", async () => {
    const files = [
      {
        name: "story.rpy",
        content: `
label start:
    scene bg room
    show eileen happy
    play music "audio/bgm/theme.ogg"
    play sound missing_sfx
    "Welcome to the game"
`,
      },
    ];

    const options = {
      projectMediaFiles: [
        "images/bg room.png",
        "images/eileen/eileen happy.png",
        "audio/bgm/theme.ogg",
        // missing_sfx is NOT present
      ],
    };

    const result = await parseRenpyFiles(files, options);

    // Should emit warning for missing_sfx
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "missing_asset",
          context: expect.objectContaining({
            category: "missing_asset",
            detail: "missing_sfx",
          }),
          message: expect.stringContaining("missing_sfx"),
        }),
      ]),
    );

    // Should NOT emit missing warnings for bg room, eileen happy, or theme.ogg
    const otherMissing = result.diagnostics?.filter(
      (d) =>
        d.code === "missing_asset" &&
        (d.context?.detail === "bg room" ||
          d.context?.detail === "eileen happy" ||
          d.context?.detail === "audio/bgm/theme.ogg"),
    );
    expect(otherMissing ?? []).toHaveLength(0);
  });

  it("suppresses missing_asset warnings when project media files are not provided", async () => {
    const files = [
      {
        name: "story.rpy",
        content: `
label start:
    scene bg room
    show eileen happy
    play music "audio/bgm/theme.ogg"
    "Welcome"
`,
      },
    ];

    // No projectMediaFiles option supplied
    const result = await parseRenpyFiles(files);

    const assetDiagnostics = result.diagnostics?.filter(
      (d) => d.code === "missing_asset",
    );
    expect(assetDiagnostics ?? []).toHaveLength(0);
  });

  it("recognizes declared image definitions and color displayables as valid", async () => {
    const files = [
      {
        name: "definitions.rpy",
        content: `
image bg custom_room = "images/actual_room.png"
image white_screen = Solid("#ffffff")
image dark_bg = "#000000"
define audio.main_theme = "music/title.ogg"
`,
      },
      {
        name: "script.rpy",
        content: `
label start:
    scene black
    scene white_screen
    scene dark_bg
    scene bg custom_room
    play music main_theme
    "Game running"
`,
      },
    ];

    const options = {
      projectMediaFiles: [
        "images/actual_room.png",
        "music/title.ogg",
      ],
    };

    const result = await parseRenpyFiles(files, options);

    const assetDiagnostics = result.diagnostics?.filter(
      (d) => d.code === "missing_asset",
    );
    expect(assetDiagnostics ?? []).toHaveLength(0);
  });

  it("handles audio playlists, chained tag modifiers, and expression keywords", async () => {
    const files = [
      {
        name: "playlist.rpy",
        content: `
label start:
    play music [ "audio/bgm1.ogg", "audio/bgm2.ogg" ]
    play sound "<silence 0.5><loop 1.0>audio/sfx.ogg"
    scene expression Solid("#123456")
    show expression "images/special.png"
    "Playing playlist and tags"
`,
      },
    ];

    const options = {
      projectMediaFiles: [
        "audio/bgm1.ogg",
        "audio/bgm2.ogg",
        "audio/sfx.ogg",
        "images/special.png",
      ],
    };

    const result = await parseRenpyFiles(files, options);

    const assetDiagnostics = result.diagnostics?.filter(
      (d) => d.code === "missing_asset",
    );
    expect(assetDiagnostics ?? []).toHaveLength(0);
  });

  it("verifies asset integrity across map-reduce linker fragments and image definitions", async () => {
    const { parseFileToFragment, linkGraphFragments } = await import(
      "../../src/parser/mapReduceLinker.ts"
    );

    const file1 = {
      name: "init.rpy",
      content: `
image bg office = "images/bg_office.png"
define audio.ambient = "music/ambient.ogg"
`,
    };
    const file2 = {
      name: "chapter1.rpy",
      content: `
label start:
    scene bg office
    play music ambient
    "At office"
`,
    };

    const { createGraphState } = await import(
      "../../src/parser/pipelineState.ts"
    );

    const prePassState = createGraphState();
    prePassState.imageDefinitions = new Map([
      ["bg office", "images/bg_office.png"],
    ]);
    prePassState.initVariables = new Map([
      ["ambient", {
        name: "ambient",
        kind: "define",
        priority: 0,
        value: "music/ambient.ogg",
      }],
    ]);

    const frag1 = await parseFileToFragment(file1, {}, prePassState, 0);
    const frag2 = await parseFileToFragment(file2, {}, prePassState, 1);

    const linkedState = linkGraphFragments([frag1, frag2], undefined, {
      projectMediaFiles: [
        "images/bg_office.png",
        "music/ambient.ogg",
      ],
    });

    const missingAssets = linkedState.diagnostics?.filter(
      (d) => d.code === "missing_asset",
    );
    expect(missingAssets ?? []).toHaveLength(0);
  });
});
