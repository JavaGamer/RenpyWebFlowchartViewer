import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { extractRpyFilesFromZip } from "../../src/application/zipExtractor";
import { corruptedZipBufferArbitrary } from "./arbitraries";

const numRuns = process.env.DEEP_FUZZ ? 5000 : 100;

describe("Zip Extractor Fuzz Testing Suite", () => {
  it(
    `fuzzes extractRpyFilesFromZip with corrupted binary zip buffers (${numRuns} runs)`,
    async () => {
      await fc.assert(
        fc.asyncProperty(corruptedZipBufferArbitrary, async (byteBuffer) => {
          const fakeFile = new File([byteBuffer], "fuzz.zip", { type: "application/zip" });
          const uploadedFile = {
            name: "fuzz.zip",
            size: byteBuffer.byteLength,
            file: fakeFile,
          };

          try {
            const extracted = await extractRpyFilesFromZip(uploadedFile);

            // If it managed to un-zip without error, it must return a valid array
            expect(Array.isArray(extracted)).toBe(true);
          } catch (err) {
            // Safety Invariant: Corrupted ZIPs must throw handled Error instances, never unhandled rejections
            expect(err).toBeInstanceOf(Error);
            expect((err as Error).message).toMatch(/Failed to decompress ZIP/);
          }
        }),
        {
          numRuns,
          interruptAfterTimeLimit: 15000,
        },
      );
    },
    30000,
  );
});
