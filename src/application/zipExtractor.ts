/**
 * src/application/zipExtractor.ts
 *
 * Selective client-side decompression of .rpy files from .zip archives.
 */

import type { UploadedFile } from "./uploadTypes.ts";

export async function extractRpyFilesFromZip(
  zipFile: UploadedFile,
): Promise<UploadedFile[]> {
  let buffer: ArrayBuffer;
  if (zipFile.file) {
    buffer = await zipFile.file.arrayBuffer();
  } else if (zipFile.arrayBuffer) {
    buffer = await zipFile.arrayBuffer();
  } else {
    throw new Error(
      `Cannot decompress ZIP "${zipFile.name}": underlying File object or arrayBuffer method is missing.`,
    );
  }
  const zipData = new Uint8Array(buffer);

  const { unzip, strFromU8 } = await import("fflate");

  return new Promise((resolve, reject) => {
    unzip(
      zipData,
      {
        filter: (file) =>
          file.name.toLowerCase().endsWith(".rpy") &&
          !file.name.endsWith("/") &&
          !file.name.endsWith("\\"),
      },
      (err, unzipped) => {
        if (err) {
          reject(new Error(`Failed to decompress ZIP: ${err.message}`));
          return;
        }

        const files: UploadedFile[] = Object.entries(unzipped)
          .filter(([path]) => !path.endsWith("/") && !path.endsWith("\\"))
          .map(([path, data]) => {
            const normalizedPath = path.replace(/\\/g, "/");
            const parts = normalizedPath.split("/");
            const name = parts.filter(Boolean).pop() || "script.rpy";
            return {
              name,
              size: data.length,
              webkitRelativePath: normalizedPath,
              relativePath: normalizedPath,
              text: async () => {
                try {
                  return strFromU8(data);
                } catch (err) {
                  throw new Error(
                    `Failed to decode text for ${normalizedPath}`,
                    { cause: err },
                  );
                }
              },
              arrayBuffer: async () => {
                try {
                  return new Uint8Array(
                    data.buffer,
                    data.byteOffset,
                    data.byteLength,
                  ).slice().buffer;
                } catch (err) {
                  throw new Error(
                    `Failed to read ArrayBuffer for ${normalizedPath}`,
                    { cause: err },
                  );
                }
              },
            };
          });
        resolve(files);
      },
    );
  });
}
