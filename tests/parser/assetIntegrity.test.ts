import { describe, expect, it } from "vitest";
import { parseRenpyFiles } from "../../src/parser/parser.ts";
import {
  buildProjectMediaIndex,
  isBuiltinOrColor,
  resolveAssetReference,
  verifyAssetIntegrity,
} from "../../src/parser/assetIntegrity.ts";
import type { ParseGraphState } from "../../src/parser/pipelineTypes.ts";

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

  it("verifies asset integrity across multi-file scripts and image definitions", async () => {
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

    const result = await parseRenpyFiles([file1, file2], {
      projectMediaFiles: [
        "images/bg_office.png",
        "music/ambient.ogg",
      ],
    });

    const missingAssets = result.diagnostics?.filter(
      (d) => d.code === "missing_asset",
    );
    expect(missingAssets ?? []).toHaveLength(0);
  });

  describe("Unit & Branch Coverage for assetIntegrity utilities", () => {
    it("tests isBuiltinOrColor variations", () => {
      expect(isBuiltinOrColor("#fff")).toBe(true);
      expect(isBuiltinOrColor("#123456")).toBe(true);
      expect(isBuiltinOrColor("#12345678")).toBe(true);
      expect(isBuiltinOrColor("black")).toBe(true);
      expect(isBuiltinOrColor("white")).toBe(true);
      expect(isBuiltinOrColor("none")).toBe(true);
      expect(isBuiltinOrColor("transparent")).toBe(true);
      expect(isBuiltinOrColor("Composite((100, 100))")).toBe(true);
      expect(isBuiltinOrColor("Transform(child)")).toBe(true);
      expect(isBuiltinOrColor("Frame('box.png')")).toBe(true);
      expect(isBuiltinOrColor("expression Solid('#000')")).toBe(true);
      expect(isBuiltinOrColor("my_custom_image")).toBe(false);
    });

    it("builds media index from Set and object arrays with relativePath and fileName", () => {
      const mediaSet = new Set<string>([
        "game\\audio\\bgm\\ambient.ogg",
        "images/characters/hero_happy.png",
        "images\\simple_file",
        "audio/theme",
        "   ",
      ]);
      const index1 = buildProjectMediaIndex(mediaSet);
      expect(index1.exactPaths.has("audio/bgm/ambient.ogg")).toBe(true);
      expect(index1.audioNames.has("ambient")).toBe(true);
      expect(index1.imageTags.has("characters hero happy")).toBe(true);

      const objectArray = [
        { relativePath: "images/bg_forest.jpg", fileName: "bg_forest.jpg" },
        { fileName: "audio/sfx/click.wav" },
        "audio/single.mp3",
        null as unknown as string,
        {} as unknown as string,
      ];
      const index2 = buildProjectMediaIndex(
        objectArray as unknown as Parameters<typeof buildProjectMediaIndex>[0],
      );
      expect(index2.lowerFilenames.has("bg_forest.jpg")).toBe(true);
      expect(index2.lowerFilenames.has("click.wav")).toBe(true);
      expect(index2.audioNames.has("single")).toBe(true);
    });

    it("resolves references with initVariables and imageDefinitions", () => {
      const mediaIndex = buildProjectMediaIndex([
        "audio/intro.ogg",
        "images/room.png",
      ]);

      const mockState = {
        initVariables: new Map<string, { value: unknown }>([
          ["audio.my_theme", { value: "audio/intro.ogg" }],
          ["my_theme", { value: "audio/intro.ogg" }],
          ["unresolved_audio", { value: "missing.ogg" }],
          ["not_a_string", { value: 12345 }],
        ]),
        imageDefinitions: new Map<string, string>([
          ["bg living_room", "images/room.png"],
          ["bg white", "#ffffff"],
          ["bg missing", "images/nonexistent.png"],
        ]),
      } as unknown as ParseGraphState;

      // Audio checks
      expect(
        resolveAssetReference(
          "expression 'audio/intro.ogg'",
          "play",
          mediaIndex,
          mockState,
        ),
      ).toBe("audio/intro.ogg");
      expect(resolveAssetReference("my_theme", "queue", mediaIndex, mockState))
        .toBe("audio/intro.ogg");
      expect(
        resolveAssetReference("audio.my_theme", "voice", mediaIndex, mockState),
      ).toBe("audio/intro.ogg");
      expect(
        resolveAssetReference(
          "unresolved_audio",
          "play",
          mediaIndex,
          mockState,
        ),
      ).toBe(null);
      expect(
        resolveAssetReference("not_a_string", "play", mediaIndex, mockState),
      ).toBe(null);
      expect(resolveAssetReference("", "play", mediaIndex, mockState)).toBe(
        null,
      );

      // Visual checks
      expect(
        resolveAssetReference("bg living_room", "scene", mediaIndex, mockState),
      ).toBe("images/room.png");
      expect(resolveAssetReference("bg white", "show", mediaIndex, mockState))
        .toBe("#ffffff");
      expect(
        resolveAssetReference("bg missing", "image", mediaIndex, mockState),
      ).toBe(null);
    });

    it("verifies asset integrity with empty inputs and playlists with partial missing assets", () => {
      const emptyState: ParseGraphState = {
        nodes: [],
        diagnostics: [],
        diagnosticIds: new Set(),
      } as unknown as ParseGraphState;

      // No media files: early return
      verifyAssetIntegrity(emptyState, []);
      verifyAssetIntegrity(emptyState, new Set());
      expect(emptyState.diagnostics).toHaveLength(0);

      // Test with node containing stop cue without asset, color asset, and mixed playlist
      const testState: ParseGraphState = {
        nodes: [
          {
            id: "node_1",
            chapter: "chap1",
            sourceLocation: { file: "test.rpy", startLine: 1, endLine: 5 },
            audioAssetCues: [
              { type: "stop", asset: "" },
              { type: "scene", asset: "black" },
              {
                type: "play",
                asset: '[ "audio/exists.ogg", "audio/missing.ogg" ]',
                sourceLocation: { file: "test.rpy", startLine: 2, endLine: 2 },
                lineNum: 2,
              },
              {
                type: "play",
                asset: "audio/missing_solo.ogg",
              },
            ],
          },
          {
            id: "node_2",
            // No audioAssetCues
          },
        ],
        diagnostics: [],
        diagnosticIds: new Set(),
        projectMediaFiles: ["audio/exists.ogg"],
      } as unknown as ParseGraphState;

      verifyAssetIntegrity(testState);

      expect(testState.nodes[0]!.audioAssetCues![1]!.isColor).toBe(true);
      expect(testState.nodes[0]!.audioAssetCues![2]!.isMissing).toBe(true);
      expect(testState.nodes[0]!.audioAssetCues![3]!.isMissing).toBe(true);

      const missingDiags = testState.diagnostics.filter((d) =>
        d.code === "missing_asset"
      );
      expect(missingDiags).toHaveLength(2);
      expect(missingDiags[0]?.message).toContain("playlist");
      expect(missingDiags[1]?.message).toContain("statement");
    });
  });
});
