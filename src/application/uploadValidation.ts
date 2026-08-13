import {
  MAX_RPY_FILE_COUNT,
  MAX_RPY_FILE_SIZE_BYTES,
  MAX_TOTAL_RPY_SIZE_BYTES,
} from "../config/uploadLimits.ts";
import type { UploadedFile } from "./uploadTypes.ts";

const MEDIA_EXTENSIONS = new Set([
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

export interface UploadValidationResult {
  rpyFiles: UploadedFile[];
  mediaFiles?: Array<{ relativePath: string; fileName: string; size?: number }>;
  errorMessage: string | null;
}

export function validateRpyUpload(
  files: FileList | UploadedFile[] | null,
): UploadValidationResult {
  if (!files || files.length === 0) {
    return { rpyFiles: [], errorMessage: null };
  }

  const rpyFiles: UploadedFile[] = [];
  const mediaFiles: Array<
    { relativePath: string; fileName: string; size?: number }
  > = [];

  const checkFile = (
    f: { name: string; size?: number; webkitRelativePath?: string },
  ) => {
    const lower = f.name.toLowerCase();
    const dotIdx = lower.lastIndexOf(".");
    const ext = dotIdx !== -1 ? lower.slice(dotIdx) : "";
    if (MEDIA_EXTENSIONS.has(ext)) {
      mediaFiles.push({
        relativePath: f.webkitRelativePath
          ? f.webkitRelativePath.replace(/\\/g, "/")
          : f.name,
        fileName: f.name,
        size: f.size,
      });
    }
  };

  if (Array.isArray(files)) {
    for (const file of files) {
      if (file.name.toLowerCase().endsWith(".rpy")) {
        rpyFiles.push(file);
      } else {
        checkFile(file);
      }
    }
  } else {
    const fileList = files as FileList;
    for (let i = 0; i < fileList.length; i++) {
      const file = fileList.item(i);
      if (file) {
        if (file.name.toLowerCase().endsWith(".rpy")) {
          rpyFiles.push({
            name: file.name,
            size: file.size,
            webkitRelativePath: file.webkitRelativePath
              ? file.webkitRelativePath.replace(/\\/g, "/")
              : undefined,
            text: () => file.text(),
            file,
          });
        } else {
          checkFile(file);
        }
      }
    }
  }

  if (rpyFiles.length === 0) {
    return {
      rpyFiles: [],
      errorMessage: "No .rpy files found in the selected directory.",
    };
  }
  if (rpyFiles.length > MAX_RPY_FILE_COUNT) {
    return {
      rpyFiles: [],
      errorMessage:
        `Too many .rpy files selected (${rpyFiles.length}). Please select ${MAX_RPY_FILE_COUNT} files or fewer.`,
    };
  }

  const totalRpySize = rpyFiles.reduce((sum, file) => sum + file.size, 0);
  if (totalRpySize > MAX_TOTAL_RPY_SIZE_BYTES) {
    const mib = (totalRpySize / (1024 * 1024)).toFixed(1);
    return {
      rpyFiles: [],
      errorMessage:
        `Selected .rpy files total ${mib} MiB, which exceeds the 25 MiB import limit. Please split the upload into smaller batches.`,
    };
  }

  const oversizedFile = rpyFiles.find((file) =>
    file.size > MAX_RPY_FILE_SIZE_BYTES
  );
  if (oversizedFile) {
    return {
      rpyFiles: [],
      errorMessage:
        `“${oversizedFile.name}” is too large to import. Please upload .rpy files smaller than 2 MiB (about 2 MB).`,
    };
  }

  return { rpyFiles, mediaFiles, errorMessage: null };
}
