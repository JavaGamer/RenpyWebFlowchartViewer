import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearUploadedFilesCache,
  getUploadedFilesCache,
  hasUploadedFilesCache,
  reparseUploadedFiles,
  setUploadedFilesCache,
  useAppStore,
  useParserRuleSettingsStore,
} from "../../src/application/index.ts";
import type { ParseService } from "../../src/application/parseService.ts";
import type { UploadedFile } from "../../src/application/uploadTypes.ts";

describe("Upload Cache and In-Viewer Reparse", () => {
  beforeEach(() => {
    clearUploadedFilesCache();
    useAppStore.getState().reset();
    useParserRuleSettingsStore.setState({
      selectedVariant: "auto",
      customVariants: [],
      customRulesByVariant: {},
    });
  });

  it("caches uploaded files and clears them properly", () => {
    expect(hasUploadedFilesCache()).toBe(false);
    expect(getUploadedFilesCache()).toBeNull();

    const mockFiles: UploadedFile[] = [
      {
        name: "script.rpy",
        size: 100,
        text: () => Promise.resolve("label start:\n    return\n"),
        arrayBuffer: () =>
          Promise.resolve(
            new TextEncoder().encode("label start:\n    return\n").buffer,
          ),
      },
    ];

    setUploadedFilesCache(mockFiles);
    expect(hasUploadedFilesCache()).toBe(true);
    const cached = getUploadedFilesCache();
    expect(cached).toHaveLength(1);
    expect(cached?.[0]?.name).toBe("script.rpy");

    clearUploadedFilesCache();
    expect(hasUploadedFilesCache()).toBe(false);
    expect(getUploadedFilesCache()).toBeNull();
  });

  it("returns false from reparseUploadedFiles if cache is empty", async () => {
    const success = await reparseUploadedFiles();
    expect(success).toBe(false);
    expect(useAppStore.getState().isReparsing).toBe(false);
  });

  it("executes in-viewer reparse, keeps isReparsing false when finished, and updates store", async () => {
    const mockFiles: UploadedFile[] = [
      {
        name: "story.rpy",
        size: 200,
        text: () =>
          Promise.resolve(`
label start:
    "Welcome to the story."
    jump chapter_one

label chapter_one:
    "Chapter one content."
    return
`),
        arrayBuffer: () =>
          Promise.resolve(
            new TextEncoder().encode(`
label start:
    "Welcome to the story."
    jump chapter_one

label chapter_one:
    "Chapter one content."
    return
`).buffer,
          ),
      },
    ];

    setUploadedFilesCache(mockFiles);
    expect(hasUploadedFilesCache()).toBe(true);

    const mockParseService = {
      parse: vi.fn().mockResolvedValue({
        nodes: [
          {
            id: "start",
            type: "NORMAL",
            role: "normal",
            label: "start",
            chapter: "story.rpy",
            dialogueCount: 1,
          },
          {
            id: "chapter_one",
            type: "NORMAL",
            role: "normal",
            label: "chapter_one",
            chapter: "story.rpy",
            dialogueCount: 1,
          },
        ],
        edges: [
          { id: "seq", source: "start", target: "chapter_one", kind: "jump" },
        ],
        diagnostics: [],
      }),
      searchDialogueLines: vi.fn().mockResolvedValue([]),
    };

    const reparsePromise = reparseUploadedFiles({
      preserveSession: true,
      parseService: mockParseService as unknown as ParseService,
    });
    const success = await reparsePromise;
    expect(success).toBe(true);

    const appState = useAppStore.getState();
    expect(appState.isReparsing).toBe(false);
    expect(appState.phase).toBe("done");
    expect(appState.flowNodes.length).toBe(2);
    expect(appState.flowEdges.length).toBe(1);
  });
});
