import { beforeEach, describe, expect, it, vi } from "vitest";
import { createProcessUpload } from "../../src/application/processUpload";
import { FileReadError } from "../../src/domain";
import { readFileAsText } from "../../src/infrastructure/fileReader";
import type { ParseService } from "../../src/application/parseService";
import type { AppActions } from "../../src/application/appStore";

vi.mock("../../src/infrastructure/fileReader", () => ({
  readFileAsText: vi.fn(),
}));

function toFileList(files: File[]): FileList {
  return {
    length: files.length,
    item: (index: number) => files[index] ?? null,
    [Symbol.iterator]: function* iterator() {
      yield* files;
    },
    ...files.reduce<Record<number, File>>((acc, file, idx) => {
      acc[idx] = file;
      return acc;
    }, {}),
  } as unknown as FileList;
}

function makeRpy(name: string, relativePath?: string): File {
  const file = new File(["label start:"], name, { type: "text/plain" });
  if (relativePath) {
    Object.defineProperty(file, "webkitRelativePath", {
      configurable: true,
      value: relativePath,
    });
  }
  return file;
}

type MockActions = {
  [
    K in keyof Pick<
      AppActions,
      | "startReading"
      | "startParsing"
      | "setProgress"
      | "partialParseSuccess"
      | "parseSuccess"
      | "fail"
    >
  ]: ReturnType<typeof vi.fn>;
};

function makeActions(): MockActions {
  return {
    startReading: vi.fn(),
    startParsing: vi.fn(),
    setProgress: vi.fn(),
    partialParseSuccess: vi.fn(),
    parseSuccess: vi.fn(),
    fail: vi.fn(),
  };
}

const LARGE_PROJECT_FILE_COUNT = 200;
const READ_BATCH_SIZE = 24;
const PARSE_BATCH_SIZE = 32;
const EXPECTED_CHUNKED_PARSE_CALLS = Math.ceil(
  LARGE_PROJECT_FILE_COUNT / READ_BATCH_SIZE,
);
const LAST_CHUNK_INDEX = EXPECTED_CHUNKED_PARSE_CALLS - 1;

describe("createProcessUpload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns early for null uploads", async () => {
    const parseService: ParseService = {
      parse: vi.fn(),
      searchDialogueLines: vi.fn(),
    };
    const actions = makeActions();
    const processUpload = createProcessUpload({
      parseService,
      actions,
      activeRunIdRef: { current: 0 },
      parseAbortControllerRef: { current: null },
    });

    await processUpload(null);

    expect(parseService.parse).not.toHaveBeenCalled();
    expect(actions.fail).not.toHaveBeenCalled();
  });

  it("dispatches FAIL when upload validation fails", async () => {
    const parseService: ParseService = {
      parse: vi.fn(),
      searchDialogueLines: vi.fn(),
    };
    const actions = makeActions();
    const processUpload = createProcessUpload({
      parseService,
      actions,
      activeRunIdRef: { current: 0 },
      parseAbortControllerRef: { current: null },
    });

    await processUpload(
      toFileList([new File(["x"], "notes.txt", { type: "text/plain" })]),
    );

    expect(actions.fail).toHaveBeenCalledWith(
      "No .rpy files found in the selected directory.",
    );
    expect(parseService.parse).not.toHaveBeenCalled();
  });

  it("runs non-chunked parse flow and dispatches success", async () => {
    vi.mocked(readFileAsText).mockImplementation(async (file: File) =>
      `content:${file.name}`
    );
    const actions = makeActions();
    const parse = vi.fn(async (request) => {
      request.onProgress?.({
        doneFiles: 2,
        totalFiles: 2,
        currentFile: "b.rpy",
      });
      return {
        nodes: [{ id: "n1", type: "LABEL", label: "n1", dialogueCount: 0 }],
        edges: [],
      };
    });
    const parseService: ParseService = {
      parse,
      searchDialogueLines: vi.fn(),
    };
    const onReadMeasured = vi.fn();
    const onParseStarted = vi.fn();
    const onParseMeasured = vi.fn();
    const processUpload = createProcessUpload({
      parseService,
      actions,
      activeRunIdRef: { current: 0 },
      parseAbortControllerRef: { current: null },
      onReadMeasured,
      onParseStarted,
      onParseMeasured,
      dialogueSearchMode: "full",
    });

    await processUpload(toFileList([makeRpy("a.rpy"), makeRpy("b.rpy")]));

    expect(onReadMeasured).toHaveBeenCalledWith(2);
    expect(onParseStarted).toHaveBeenCalledTimes(1);
    expect(parse).toHaveBeenCalledTimes(1);
    expect(parse).toHaveBeenCalledWith(
      expect.objectContaining({
        appendToActiveGraph: true,
        resetActiveGraph: true,
        isFinalChunk: true,
        captureDialogueLines: true,
      }),
    );
    expect(actions.parseSuccess).toHaveBeenCalledWith(
      [{ id: "n1", type: "LABEL", label: "n1", dialogueCount: 0 }],
      [],
      [],
    );
    expect(onParseMeasured).toHaveBeenCalledWith({
      fileCount: 2,
      nodeCount: 1,
      edgeCount: 0,
    });
  });

  it("sorts uploads by relative path and forwards stable file identity to parsing", async () => {
    vi.mocked(readFileAsText).mockImplementation(async (file: File) =>
      `content:${file.name}`
    );
    const actions = makeActions();
    const parse = vi.fn(async () => ({
      nodes: [{ id: "n1", type: "LABEL", label: "n1", dialogueCount: 0 }],
      edges: [],
    }));
    const parseService: ParseService = {
      parse,
      searchDialogueLines: vi.fn(),
    };
    const processUpload = createProcessUpload({
      parseService,
      actions,
      activeRunIdRef: { current: 0 },
      parseAbortControllerRef: { current: null },
    });

    await processUpload(
      toFileList([
        makeRpy("script.rpy", "routes/beta/script.rpy"),
        makeRpy("script.rpy", "routes/alpha/script.rpy"),
      ]),
    );

    expect(parse).toHaveBeenCalledWith(
      expect.objectContaining({
        files: [
          expect.objectContaining({
            name: "script.rpy",
            relativePath: "routes/alpha/script.rpy",
          }),
          expect.objectContaining({
            name: "script.rpy",
            relativePath: "routes/beta/script.rpy",
          }),
        ],
      }),
    );
  });

  it("captures dialogue lines in auto mode for non-large uploads", async () => {
    vi.mocked(readFileAsText).mockImplementation(async (file: File) =>
      `content:${file.name}`
    );
    const actions = makeActions();
    const parse = vi.fn(async () => ({
      nodes: [{ id: "n1", type: "LABEL", label: "n1", dialogueCount: 0 }],
      edges: [],
    }));
    const parseService: ParseService = {
      parse,
      searchDialogueLines: vi.fn(),
    };
    const processUpload = createProcessUpload({
      parseService,
      actions,
      activeRunIdRef: { current: 0 },
      parseAbortControllerRef: { current: null },
      dialogueSearchMode: "auto",
    });

    await processUpload(toFileList([makeRpy("a.rpy")]));

    expect(parse).toHaveBeenCalledWith(
      expect.objectContaining({
        captureDialogueLines: true,
      }),
    );
  });

  it("uses chunked parse flow for large uploads and emits partial updates", async () => {
    vi.mocked(readFileAsText).mockImplementation(async (file: File) =>
      `content:${file.name}`
    );
    const actions = makeActions();
    let callIndex = 0;
    const parse = vi.fn(async (request) => {
      callIndex += 1;
      request.onProgress?.({
        doneFiles: request.files.length,
        totalFiles: request.files.length,
        currentFile: request.files[request.files.length - 1].name,
      });
      if (callIndex === 1) {
        request.onPartialResult?.({
          nodes: [{
            id: "partial",
            type: "LABEL",
            label: "partial",
            dialogueCount: 0,
          }],
          edges: [],
        });
      }
      return {
        nodes: [{
          id: `n-${callIndex}`,
          type: "LABEL",
          label: `n-${callIndex}`,
          dialogueCount: 0,
        }],
        edges: [],
      };
    });
    const parseService: ParseService = {
      parse,
      searchDialogueLines: vi.fn(),
    };
    const processUpload = createProcessUpload({
      parseService,
      actions,
      activeRunIdRef: { current: 0 },
      parseAbortControllerRef: { current: null },
      dialogueSearchMode: "auto",
    });
    const files = Array.from(
      { length: LARGE_PROJECT_FILE_COUNT },
      (_, i) => makeRpy(`f${i + 1}.rpy`),
    );

    await processUpload(toFileList(files));

    expect(PARSE_BATCH_SIZE).toBeGreaterThanOrEqual(READ_BATCH_SIZE);
    expect(parse).toHaveBeenCalledTimes(EXPECTED_CHUNKED_PARSE_CALLS);
    expect(parse.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        appendToActiveGraph: true,
        resetActiveGraph: true,
        isFinalChunk: false,
        captureDialogueLines: false,
      }),
    );
    expect(parse.mock.calls[LAST_CHUNK_INDEX]?.[0]).toEqual(
      expect.objectContaining({
        resetActiveGraph: false,
        isFinalChunk: true,
      }),
    );
    expect(actions.partialParseSuccess).toHaveBeenCalledWith(
      [{ id: "partial", type: "LABEL", label: "partial", dialogueCount: 0 }],
      [],
      [],
    );
    expect(actions.parseSuccess).toHaveBeenCalled();
    expect(actions.partialParseSuccess).toHaveBeenCalledTimes(1);
  });

  it("dispatches file read failures with mapped message", async () => {
    vi.mocked(readFileAsText).mockRejectedValue(new FileReadError("bad.rpy"));
    const actions = makeActions();
    const parseService: ParseService = {
      parse: vi.fn(),
      searchDialogueLines: vi.fn(),
    };
    const processUpload = createProcessUpload({
      parseService,
      actions,
      activeRunIdRef: { current: 0 },
      parseAbortControllerRef: { current: null },
    });

    await processUpload(toFileList([makeRpy("bad.rpy")]));

    expect(actions.fail).toHaveBeenCalledWith(
      'Could not read "bad.rpy". The file may be inaccessible or corrupted.',
    );
    expect(parseService.parse).not.toHaveBeenCalled();
  });

  it("dispatches parse failures with mapped cancellation message", async () => {
    vi.mocked(readFileAsText).mockResolvedValue("label start:");
    const actions = makeActions();
    const parseService: ParseService = {
      parse: vi.fn().mockRejectedValue(
        new DOMException("Parsing cancelled", "AbortError"),
      ),
      searchDialogueLines: vi.fn(),
    };
    const processUpload = createProcessUpload({
      parseService,
      actions,
      activeRunIdRef: { current: 0 },
      parseAbortControllerRef: { current: null },
    });

    await processUpload(toFileList([makeRpy("a.rpy")]));

    expect(actions.fail).toHaveBeenCalledWith("Parsing was cancelled.");
  });
});
