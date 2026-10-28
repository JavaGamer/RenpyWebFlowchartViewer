/**
 * src/application/uploadTypes.ts
 *
 * Types for uniform file handling and status tracking.
 */

import type {
  FlowEdge,
  FlowNode,
  ProjectTranslations,
} from "../domain/index.ts";
import type { ParseDiagnosticPayload } from "../infrastructure/index.ts";
import type { VariantDetectionResult } from "../config/parserRules.ts";

export type DialogueSearchMode = "auto" | "full" | "countOnly";

export interface ProcessUploadActions {
  startReading: (totalFiles: number) => void;
  startParsing: () => void;
  setProgress: (progress: {
    doneFiles: number;
    totalFiles: number;
    currentFile: string;
  }) => void;
  partialParseSuccess: (
    nodes: FlowNode[],
    edges: FlowEdge[],
    diagnostics?: ParseDiagnosticPayload[],
  ) => void;
  parseSuccess: (
    nodes: FlowNode[],
    edges: FlowEdge[],
    diagnostics?: ParseDiagnosticPayload[],
    translations?: ProjectTranslations | null,
    meta?: {
      parsedVariant?: string;
      isVariantAutoDetected?: boolean;
      variantDetectionResult?: VariantDetectionResult;
      preserveSession?: boolean;
    },
  ) => void;
  fail: (errorMessage: string) => void;
  setIsReparsing?: (isReparsing: boolean) => void;
}

export interface UploadedFile {
  name: string;
  size: number;
  webkitRelativePath?: string;
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
