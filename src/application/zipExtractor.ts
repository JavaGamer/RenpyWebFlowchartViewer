/**
 * src/application/zipExtractor.ts
 *
 * Selective client-side decompression of .rpy files from .zip archives.
 */

import type { UploadedFile } from "./uploadTypes.ts";

const MAX_TOTAL_EXTRACTED_BYTES = 200 * 1024 * 1024;

const ACCEPTED_ZIP_EXTENSIONS = new Set([
  ".rpy",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".avif",
  ".gif",
  ".svg",
  ".ogg",
  ".opus",
  ".mp3",
  ".wav",
  ".flac",
  ".webm",
  ".mp4",
]);

function isAcceptedExtension(filename: string): boolean {
  const lower = filename.replace(/\\/g, "/").toLowerCase();
  const dotIdx = lower.lastIndexOf(".");
  if (dotIdx === -1) return false;
  return ACCEPTED_ZIP_EXTENSIONS.has(lower.slice(dotIdx));
}

export async function extractRpyFilesFromZip(
  zipFile: UploadedFile,
): Promise<UploadedFile[]> {
  const buffer = zipFile.file
    ? await zipFile.file.arrayBuffer()
    : zipFile.arrayBuffer
    ? await zipFile.arrayBuffer()
    : null;
  if (!buffer) {
    throw new Error(
      `Cannot decompress ZIP "${zipFile.name}": underlying File object is missing.`,
    );
  }

  const zipData = new Uint8Array(buffer);

  const { unzip, strFromU8 } = await import("fflate");

  return new Promise((resolve, reject) => {
    let cumulativeHeaderSize = 0;

    unzip(
      zipData,
      {
        filter: (file) => {
          if (!isAcceptedExtension(file.name)) return false;
          if (file.originalSize) {
            cumulativeHeaderSize += file.originalSize;
            if (cumulativeHeaderSize > MAX_TOTAL_EXTRACTED_BYTES) {
              return false;
            }
          }
          return true;
        },
      },
      (err, unzipped) => {
        if (err) {
          reject(new Error(`Failed to decompress ZIP: ${err.message}`));
          return;
        }

        if (cumulativeHeaderSize > MAX_TOTAL_EXTRACTED_BYTES) {
          reject(
            new Error(
              "Decompressed ZIP exceeds maximum permitted size (200MB).",
            ),
          );
          return;
        }

        let totalSize = 0;
        const files: UploadedFile[] = [];

        for (const [path, data] of Object.entries(unzipped)) {
          totalSize += data.length;
          if (totalSize > MAX_TOTAL_EXTRACTED_BYTES) {
            reject(
              new Error(
                "Decompressed ZIP exceeds maximum permitted size (200MB).",
              ),
            );
            return;
          }

          const cleanPath = path
            .replace(/\\/g, "/")
            .split("/")
            .filter((part) => part !== "" && part !== "." && part !== "..")
            .join("/");
          const parts = cleanPath.split("/");
          const name = parts[parts.length - 1] || cleanPath;

          files.push({
            name,
            size: data.length,
            webkitRelativePath: cleanPath,
            text: () => Promise.resolve(strFromU8(data)),
            arrayBuffer: () =>
              Promise.resolve(
                data.buffer.slice(
                  data.byteOffset,
                  data.byteOffset + data.byteLength,
                ),
              ),
          });
        }
        resolve(files);
      },
    );
  });
}
