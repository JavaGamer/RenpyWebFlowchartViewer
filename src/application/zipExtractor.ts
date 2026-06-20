/**
 * src/application/zipExtractor.ts
 *
 * Selective client-side decompression of .rpy files from .zip archives.
 */

import type { UploadedFile } from "./uploadTypes.ts";

export async function extractRpyFilesFromZip(
  zipFile: UploadedFile,
): Promise<UploadedFile[]> {
  const nativeFile = zipFile.file;
  if (!nativeFile) {
    throw new Error(
      `Cannot decompress ZIP "${zipFile.name}": underlying File object is missing.`,
    );
  }

  const buffer = await nativeFile.arrayBuffer();
  const zipData = new Uint8Array(buffer);

  const { unzip, strFromU8 } = await import("fflate");

  return new Promise((resolve, reject) => {
    unzip(
      zipData,
      {
        filter: (file) => file.name.toLowerCase().endsWith(".rpy"),
      },
      (err, unzipped) => {
        if (err) {
          reject(new Error(`Failed to decompress ZIP: ${err.message}`));
          return;
        }

        const files: UploadedFile[] = Object.entries(unzipped).map(
          ([path, data]) => {
            const parts = path.split("/");
            const name = parts[parts.length - 1];
            return {
              name,
              size: data.length,
              webkitRelativePath: path,
              text: async () => strFromU8(data),
            };
          },
        );
        resolve(files);
      },
    );
  });
}
