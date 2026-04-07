import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createProcessUpload } from '../src/application/processUpload';
import { FileReadError, readFileAsText } from '../src/infrastructure/fileReader';
import type { ParseService } from '../src/application/parseService';

vi.mock('../src/infrastructure/fileReader', () => ({
  readFileAsText: vi.fn(),
  FileReadError: class FileReadError extends Error {
    constructor(filename: string) {
      super(`Could not read "${filename}". The file may be inaccessible or corrupted.`);
      this.name = 'FileReadError';
    }
  },
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

function makeRpy(name: string): File {
  return new File(['label start:'], name, { type: 'text/plain' });
}

const LARGE_PROJECT_FILE_COUNT = 200;
const READ_BATCH_SIZE = 24;
const PARSE_BATCH_SIZE = 32;
const EXPECTED_CHUNKED_PARSE_CALLS = Math.ceil(LARGE_PROJECT_FILE_COUNT / READ_BATCH_SIZE);
const LAST_CHUNK_INDEX = EXPECTED_CHUNKED_PARSE_CALLS - 1;

describe('createProcessUpload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns early for null uploads', async () => {
    const parseService: ParseService = {
      parse: vi.fn(),
      searchDialogueLines: vi.fn(),
    };
    const dispatch = vi.fn();
    const processUpload = createProcessUpload({
      parseService,
      dispatch,
      activeRunIdRef: { current: 0 },
      parseAbortControllerRef: { current: null },
    });

    await processUpload(null);

    expect(parseService.parse).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('dispatches FAIL when upload validation fails', async () => {
    const parseService: ParseService = {
      parse: vi.fn(),
      searchDialogueLines: vi.fn(),
    };
    const dispatch = vi.fn();
    const processUpload = createProcessUpload({
      parseService,
      dispatch,
      activeRunIdRef: { current: 0 },
      parseAbortControllerRef: { current: null },
    });

    await processUpload(toFileList([new File(['x'], 'notes.txt', { type: 'text/plain' })]));

    expect(dispatch).toHaveBeenCalledWith({
      type: 'FAIL',
      message: 'No .rpy files found in the selected directory.',
    });
    expect(parseService.parse).not.toHaveBeenCalled();
  });

  it('runs non-chunked parse flow and dispatches success', async () => {
    vi.mocked(readFileAsText).mockImplementation(async (file: File) => `content:${file.name}`);
    const dispatch = vi.fn();
    const parse = vi.fn(async (request) => {
      request.onProgress?.({ doneFiles: 2, totalFiles: 2, currentFile: 'b.rpy' });
      return { nodes: [{ id: 'n1', type: 'LABEL', label: 'n1', dialogueCount: 0 }], edges: [] };
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
      dispatch,
      activeRunIdRef: { current: 0 },
      parseAbortControllerRef: { current: null },
      onReadMeasured,
      onParseStarted,
      onParseMeasured,
      dialogueSearchMode: 'full',
    });

    await processUpload(toFileList([makeRpy('a.rpy'), makeRpy('b.rpy')]));

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
    expect(dispatch).toHaveBeenCalledWith({
      type: 'PARSE_SUCCESS',
      nodes: [{ id: 'n1', type: 'LABEL', label: 'n1', dialogueCount: 0 }],
      edges: [],
      warnings: [],
    });
    expect(onParseMeasured).toHaveBeenCalledWith({ fileCount: 2, nodeCount: 1, edgeCount: 0 });
  });

  it('uses chunked parse flow for large uploads and emits partial updates', async () => {
    vi.mocked(readFileAsText).mockImplementation(async (file: File) => `content:${file.name}`);
    const dispatch = vi.fn();
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
          nodes: [{ id: 'partial', type: 'LABEL', label: 'partial', dialogueCount: 0 }],
          edges: [],
        });
      }
      return {
        nodes: [{ id: `n-${callIndex}`, type: 'LABEL', label: `n-${callIndex}`, dialogueCount: 0 }],
        edges: [],
      };
    });
    const parseService: ParseService = {
      parse,
      searchDialogueLines: vi.fn(),
    };
    const processUpload = createProcessUpload({
      parseService,
      dispatch,
      activeRunIdRef: { current: 0 },
      parseAbortControllerRef: { current: null },
      dialogueSearchMode: 'auto',
    });
    const files = Array.from({ length: LARGE_PROJECT_FILE_COUNT }, (_, i) => makeRpy(`f${i + 1}.rpy`));

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
    expect(dispatch).toHaveBeenCalledWith({
      type: 'PARTIAL_PARSE_SUCCESS',
      nodes: [{ id: 'partial', type: 'LABEL', label: 'partial', dialogueCount: 0 }],
      edges: [],
      warnings: [],
    });
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'PARSE_SUCCESS',
      }),
    );
    expect(dispatch.mock.calls.filter(([action]) => action?.type === 'PARTIAL_PARSE_SUCCESS')).toHaveLength(1);
  });

  it('dispatches file read failures with mapped message', async () => {
    vi.mocked(readFileAsText).mockRejectedValue(new FileReadError('bad.rpy'));
    const dispatch = vi.fn();
    const parseService: ParseService = {
      parse: vi.fn(),
      searchDialogueLines: vi.fn(),
    };
    const processUpload = createProcessUpload({
      parseService,
      dispatch,
      activeRunIdRef: { current: 0 },
      parseAbortControllerRef: { current: null },
    });

    await processUpload(toFileList([makeRpy('bad.rpy')]));

    expect(dispatch).toHaveBeenCalledWith({
      type: 'FAIL',
      message: 'Could not read "bad.rpy". The file may be inaccessible or corrupted.',
    });
    expect(parseService.parse).not.toHaveBeenCalled();
  });

  it('dispatches parse failures with mapped cancellation message', async () => {
    vi.mocked(readFileAsText).mockResolvedValue('label start:');
    const dispatch = vi.fn();
    const parseService: ParseService = {
      parse: vi.fn().mockRejectedValue(new DOMException('Parsing cancelled', 'AbortError')),
      searchDialogueLines: vi.fn(),
    };
    const processUpload = createProcessUpload({
      parseService,
      dispatch,
      activeRunIdRef: { current: 0 },
      parseAbortControllerRef: { current: null },
    });

    await processUpload(toFileList([makeRpy('a.rpy')]));

    expect(dispatch).toHaveBeenCalledWith({
      type: 'FAIL',
      message: 'Parsing was cancelled.',
    });
  });
});
