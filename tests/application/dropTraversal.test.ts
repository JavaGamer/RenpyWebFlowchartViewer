import { describe, expect, it } from "vitest";
import {
  traverseDataTransferItems,
  traverseFileSystemEntry,
} from "../../src/application/dropTraversal.ts";

describe("application / dropTraversal", () => {
  it("traverses a single file system entry (file)", async () => {
    const mockFile = new File(["content"], "script.rpy", {
      type: "text/plain",
    });

    const fileEntry: Partial<FileSystemFileEntry> = {
      isFile: true,
      isDirectory: false,
      name: "script.rpy",
      file: (successCallback) => successCallback(mockFile),
    };

    const result = await traverseFileSystemEntry(
      fileEntry as FileSystemFileEntry,
    );
    expect(result.length).toBe(1);
    expect(result[0].name).toBe("script.rpy");
    expect(result[0].size).toBe(mockFile.size);
    expect(result[0].webkitRelativePath).toBe("script.rpy");
  });

  it("traverses directory entries recursively", async () => {
    const mockFile1 = new File(["label start:"], "script.rpy");
    const mockFile2 = new File(["label ch1:"], "ch1.rpy");

    const fileEntry1: Partial<FileSystemFileEntry> = {
      isFile: true,
      isDirectory: false,
      name: "script.rpy",
      file: (cb) => cb(mockFile1),
    };

    const fileEntry2: Partial<FileSystemFileEntry> = {
      isFile: true,
      isDirectory: false,
      name: "ch1.rpy",
      file: (cb) => cb(mockFile2),
    };

    let readCount = 0;
    const mockReader: Partial<FileSystemDirectoryReader> = {
      readEntries: (successCallback) => {
        if (readCount === 0) {
          readCount++;
          successCallback([
            fileEntry1 as FileSystemEntry,
            fileEntry2 as FileSystemEntry,
          ]);
        } else {
          successCallback([]);
        }
      },
    };

    const dirEntry: Partial<FileSystemDirectoryEntry> = {
      isFile: false,
      isDirectory: true,
      name: "game",
      createReader: () => mockReader as FileSystemDirectoryReader,
    };

    const result = await traverseFileSystemEntry(
      dirEntry as FileSystemDirectoryEntry,
    );
    expect(result.length).toBe(2);
    expect(result.map((f) => f.name)).toEqual(["script.rpy", "ch1.rpy"]);
    expect(result.map((f) => f.webkitRelativePath)).toEqual([
      "game/script.rpy",
      "game/ch1.rpy",
    ]);
  });

  it("traverses DataTransferItemList with file items", async () => {
    const mockFile = new File(["data"], "test.rpy");
    const fileEntry: Partial<FileSystemFileEntry> = {
      isFile: true,
      isDirectory: false,
      name: "test.rpy",
      file: (cb) => cb(mockFile),
    };

    const mockItem: Partial<DataTransferItem> = {
      kind: "file",
      webkitGetAsEntry: () => fileEntry as FileSystemEntry,
    };

    const items = [mockItem] as unknown as DataTransferItemList;
    Object.defineProperty(items, "length", { value: 1 });

    const result = await traverseDataTransferItems(items);
    expect(result.length).toBe(1);
    expect(result[0].name).toBe("test.rpy");
  });
});
