/**
 * src/application/uploadTypes.ts
 *
 * Types for uniform file handling and status tracking.
 */

export interface UploadedFile {
  name: string;
  size: number;
  webkitRelativePath?: string;
  relativePath?: string;
  text: () => Promise<string>;
  arrayBuffer?: () => Promise<ArrayBuffer>;
  file?: File;
}

export interface UploadFileStatus {
  id: string; // relativePath || name
  name: string;
  size: number;
  relativePath?: string;
  status: "pending" | "reading" | "parsing" | "done" | "error";
  error?: string;
}
