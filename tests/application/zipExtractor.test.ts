import { describe, expect, it } from "vitest";
import { extractRpyFilesFromZip } from "../../src/application/zipExtractor.ts";
import type { UploadedFile } from "../../src/application/uploadTypes.ts";
import { strToU8, zipSync } from "fflate";

describe("application / zipExtractor", () => {
  it("throws error when underlying File object is missing", async () => {
    const fakeZipFile: UploadedFile = {
      name: "test.zip",
      size: 100,
    };

    await expect(extractRpyFilesFromZip(fakeZipFile)).rejects.toThrow(
      'Cannot decompress ZIP "test.zip": underlying File object or arrayBuffer method is missing.',
    );
  });

  it("extracts .rpy files and ignores non-.rpy files from ZIP archive", async () => {
    const zippedData = zipSync({
      "script.rpy": strToU8("label start:\n    return"),
      "sub/chapter1.rpy": strToU8("label ch1:\n    pass"),
      "image.png": strToU8("fake image data"),
      "notes.txt": strToU8("some notes"),
    });

    const mockFile = new File([zippedData.buffer], "game.zip", {
      type: "application/zip",
    });

    const zipUploadedFile: UploadedFile = {
      name: "game.zip",
      size: zippedData.length,
      file: mockFile,
    };

    const extracted = await extractRpyFilesFromZip(zipUploadedFile);
    expect(extracted.length).toBe(2);

    const names = extracted.map((f) => f.name);
    expect(names).toContain("script.rpy");
    expect(names).toContain("chapter1.rpy");

    const scriptFile = extracted.find((f) => f.name === "script.rpy")!;
    expect(scriptFile.webkitRelativePath).toBe("script.rpy");
    expect(await scriptFile.text!()).toBe("label start:\n    return");

    const ab = await scriptFile.arrayBuffer!();
    expect(ab.byteLength).toBe(strToU8("label start:\n    return").length);
  });
});
