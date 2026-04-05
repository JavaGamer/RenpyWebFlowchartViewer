import {
  MAX_RPY_FILE_COUNT,
  MAX_RPY_FILE_SIZE_BYTES,
  MAX_TOTAL_RPY_SIZE_BYTES,
} from '../config/uploadLimits';

export interface UploadValidationResult {
  rpyFiles: File[];
  errorMessage: string | null;
}

export function validateRpyUpload(files: FileList | null): UploadValidationResult {
  if (!files || files.length === 0) {
    return { rpyFiles: [], errorMessage: null };
  }

  const rpyFiles: File[] = [];
  for (const file of files) {
    if (file.name.toLowerCase().endsWith('.rpy')) rpyFiles.push(file);
  }

  if (rpyFiles.length === 0) {
    return { rpyFiles: [], errorMessage: 'No .rpy files found in the selected directory.' };
  }
  if (rpyFiles.length > MAX_RPY_FILE_COUNT) {
    return {
      rpyFiles: [],
      errorMessage: `Too many .rpy files selected (${rpyFiles.length}). Please select ${MAX_RPY_FILE_COUNT} files or fewer.`,
    };
  }

  const totalRpySize = rpyFiles.reduce((sum, file) => sum + file.size, 0);
  if (totalRpySize > MAX_TOTAL_RPY_SIZE_BYTES) {
    const mib = (totalRpySize / (1024 * 1024)).toFixed(1);
    return {
      rpyFiles: [],
      errorMessage: `Selected .rpy files total ${mib} MiB, which exceeds the 25 MiB import limit. Please split the upload into smaller batches.`,
    };
  }

  const oversizedFile = rpyFiles.find((file) => file.size > MAX_RPY_FILE_SIZE_BYTES);
  if (oversizedFile) {
    return {
      rpyFiles: [],
      errorMessage: `“${oversizedFile.name}” is too large to import. Please upload .rpy files smaller than 2 MiB (about 2 MB).`,
    };
  }

  return { rpyFiles, errorMessage: null };
}
