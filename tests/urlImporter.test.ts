import { beforeEach, describe, expect, it, vi } from "vitest";
import { strToU8, zipSync } from "fflate";
import {
  fetchFilesFromUrl,
  resolveGithubUrl,
} from "../src/application/urlImporter.ts";
import * as zipExtractorModule from "../src/application/zipExtractor.ts";
import type { UploadedFile } from "../src/application/uploadTypes.ts";

describe("resolveGithubUrl", () => {
  it("resolves standard GitHub repo URL to main branch ZIP download", () => {
    expect(
      resolveGithubUrl("https://github.com/JavaGamer/RenpyWebFlowchartViewer"),
    ).toBe(
      "https://github.com/JavaGamer/RenpyWebFlowchartViewer/archive/refs/heads/main.zip",
    );
  });

  it("resolves GitHub blob file URL to raw content URL", () => {
    expect(
      resolveGithubUrl(
        "https://github.com/JavaGamer/RenpyWebFlowchartViewer/blob/main/tests/fixtures/simple.rpy",
      ),
    ).toBe(
      "https://raw.githubusercontent.com/JavaGamer/RenpyWebFlowchartViewer/main/tests/fixtures/simple.rpy",
    );
  });

  it("resolves GitHub raw file URL to raw content URL", () => {
    expect(
      resolveGithubUrl(
        "https://github.com/JavaGamer/RenpyWebFlowchartViewer/raw/main/tests/fixtures/simple.rpy",
      ),
    ).toBe(
      "https://raw.githubusercontent.com/JavaGamer/RenpyWebFlowchartViewer/main/tests/fixtures/simple.rpy",
    );
  });

  it("keeps raw script URL unmodified", () => {
    const rawUrl =
      "https://raw.githubusercontent.com/JavaGamer/RenpyWebFlowchartViewer/main/src/App.tsx";
    expect(resolveGithubUrl(rawUrl)).toBe(rawUrl);
  });

  it("keeps explicit ZIP URL unmodified", () => {
    const zipUrl = "https://example.com/project.zip";
    expect(resolveGithubUrl(zipUrl)).toBe(zipUrl);
  });
});

describe("fetchFilesFromUrl", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches and returns a raw .rpy script file", async () => {
    const mockResponse = {
      ok: true,
      headers: {
        get: (name: string) => (name === "Content-Type" ? "text/plain" : null),
      },
      text: () => Promise.resolve('label start:\n    "Hello world"'),
    } as unknown as Response;

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockResponse,
    );

    const result = await fetchFilesFromUrl(
      "https://example.com/game/script.rpy",
    );
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://example.com/game/script.rpy",
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe("script.rpy");
    expect(await result[0]?.text()).toBe('label start:\n    "Hello world"');
  });

  it("fetches a .zip archive and extracts .rpy files", async () => {
    const zipped = zipSync({
      "nested/extracted.rpy": strToU8('label start:\n    "From zip"'),
    });
    const mockBuffer = zipped.buffer.slice(
      zipped.byteOffset,
      zipped.byteOffset + zipped.byteLength,
    ) as ArrayBuffer;
    const mockResponse = {
      ok: true,
      headers: {
        get: (
          name: string,
        ) => (name === "Content-Type" ? "application/zip" : null),
      },
      arrayBuffer: () => Promise.resolve(mockBuffer),
    } as unknown as Response;

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockResponse,
    );
    const mockExtracted: UploadedFile[] = [{
      name: "extracted.rpy",
      size: 10,
      text: () => Promise.resolve("extracted"),
    }];
    const extractSpy = vi.spyOn(zipExtractorModule, "extractRpyFilesFromZip")
      .mockResolvedValue(mockExtracted);

    const result = await fetchFilesFromUrl("https://example.com/archive.zip");
    expect(fetchSpy).toHaveBeenCalledWith("https://example.com/archive.zip");
    expect(extractSpy).toHaveBeenCalled();
    expect(result).toEqual(mockExtracted);
  });

  it("throws a network/CORS error when fetch fails", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new TypeError("Failed to fetch"),
    );

    await expect(fetchFilesFromUrl("https://example.com/cors-blocked.rpy"))
      .rejects.toThrow(
        /Network request failed/,
      );
  });

  it("throws an error when response status is not ok", async () => {
    const mockResponse = {
      ok: false,
      status: 404,
      statusText: "Not Found",
    } as unknown as Response;

    vi.spyOn(globalThis, "fetch").mockResolvedValue(mockResponse);

    await expect(fetchFilesFromUrl("https://example.com/missing.rpy")).rejects
      .toThrow(
        /Failed to fetch from URL: Not Found \(404\)/,
      );
  });

  it("throws an error when fetched URL points to an unsupported file type", async () => {
    const mockResponse = {
      ok: true,
      headers: {
        get: (name: string) => (name === "Content-Type" ? "image/png" : null),
      },
      text: () => Promise.resolve("fake image content"),
    } as unknown as Response;

    vi.spyOn(globalThis, "fetch").mockResolvedValue(mockResponse);

    await expect(fetchFilesFromUrl("https://example.com/pic.png")).rejects
      .toThrow(
        /fetched URL does not appear to be a \.rpy script/,
      );
  });

  it("prepends https:// when protocol is missing", async () => {
    const mockResponse = {
      ok: true,
      headers: {
        get: (name: string) => (name === "Content-Type" ? "text/plain" : null),
      },
      text: () => Promise.resolve('label start:\n    "hello"'),
    } as unknown as Response;

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockResponse,
    );

    const result = await fetchFilesFromUrl("example.com/game/script.rpy");
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://example.com/game/script.rpy",
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe("script.rpy");
    expect(await result[0]?.text()).toBe('label start:\n    "hello"');
  });
});
