import { afterEach, describe, expect, it, vi } from "vitest";
import { FileReadError } from "../../src/domain";
import { readFileAsText } from "../../src/infrastructure/fileReader";

type ReaderEventMode = "load" | "error" | "abort";

class MockFileReader {
  static nextMode: ReaderEventMode = "load";
  static nextResult: string | ArrayBuffer | null = "";

  result: string | ArrayBuffer | null = null;
  onload:
    | ((this: FileReader, ev: ProgressEvent<FileReader>) => unknown)
    | null = null;
  onerror:
    | ((this: FileReader, ev: ProgressEvent<FileReader>) => unknown)
    | null = null;
  onabort:
    | ((this: FileReader, ev: ProgressEvent<FileReader>) => unknown)
    | null = null;

  readAsText(): void {
    this.result = MockFileReader.nextResult;
    queueMicrotask(() => {
      if (MockFileReader.nextMode === "load") {
        this.onload?.call(
          this as unknown as FileReader,
          {} as ProgressEvent<FileReader>,
        );
        return;
      }
      if (MockFileReader.nextMode === "abort") {
        this.onabort?.call(
          this as unknown as FileReader,
          {} as ProgressEvent<FileReader>,
        );
        return;
      }
      this.onerror?.call(
        this as unknown as FileReader,
        {} as ProgressEvent<FileReader>,
      );
    });
  }
}

describe("readFileAsText", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("resolves when FileReader returns text", async () => {
    MockFileReader.nextMode = "load";
    MockFileReader.nextResult = "label start:";
    vi.stubGlobal("FileReader", MockFileReader as unknown as typeof FileReader);

    await expect(readFileAsText(new File(["x"], "ok.rpy"))).resolves.toBe(
      "label start:",
    );
  });

  it("rejects with FileReadError when FileReader result is not text", async () => {
    MockFileReader.nextMode = "load";
    MockFileReader.nextResult = null;
    vi.stubGlobal("FileReader", MockFileReader as unknown as typeof FileReader);

    await expect(readFileAsText(new File(["x"], "bad.rpy"))).rejects
      .toBeInstanceOf(FileReadError);
  });

  it("rejects with FileReadError when FileReader aborts", async () => {
    MockFileReader.nextMode = "abort";
    MockFileReader.nextResult = null;
    vi.stubGlobal("FileReader", MockFileReader as unknown as typeof FileReader);

    await expect(readFileAsText(new File(["x"], "cancelled.rpy"))).rejects
      .toMatchObject({
        name: "FileReadError",
      });
  });
});
