import type { UploadedFile } from "./uploadTypes.ts";

let cachedFiles: UploadedFile[] | null = null;

export function setUploadedFilesCache(
  files: UploadedFile[] | FileList | null,
): void {
  if (!files) {
    cachedFiles = null;
    return;
  }
  if (Array.isArray(files)) {
    cachedFiles = [...files];
  } else {
    const arr: UploadedFile[] = [];
    for (let i = 0; i < files.length; i++) {
      const f = files.item(i);
      if (f) {
        arr.push({
          name: f.name,
          size: f.size,
          webkitRelativePath: f.webkitRelativePath || undefined,
          text: () => f.text(),
          arrayBuffer: () => f.arrayBuffer(),
          file: f,
        });
      }
    }
    cachedFiles = arr;
  }
}

export function getUploadedFilesCache(): UploadedFile[] | null {
  return cachedFiles ? [...cachedFiles] : null;
}

export function hasUploadedFilesCache(): boolean {
  return Boolean(cachedFiles && cachedFiles.length > 0);
}

export function clearUploadedFilesCache(): void {
  cachedFiles = null;
}
