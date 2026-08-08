/**
 * src/application/processUpload.ts
 *
 * Upload orchestrator that converts a FileList or an array of UploadedFiles
 * into a fully parsed FlowGraph, with ZIP decompression, folder drops,
 * and real-time status reporting.
 */

import type { RefObject } from "react";
import {
  compareDeterministicStrings,
  type FlowEdge,
  type FlowNode,
  UploadValidationError,
} from "../domain/index.ts";
import {
  type ParseDiagnosticPayload,
  readFileAsArrayBuffer,
} from "../infrastructure/index.ts";

import { validateRpyUpload } from "./uploadValidation.ts";
import type { AppActions, DialogueSearchMode } from "./appStore.ts";
import {
  toFileReadErrorMessage,
  toParseErrorMessage,
} from "./errorMessages.ts";
import type { ParseService } from "./parseService.ts";
import type { ParserVariant, ScreenActionRule } from "../config/parserRules.ts";
import type { UploadedFile, UploadFileStatus } from "./uploadTypes.ts";
import { extractRpyFilesFromZip } from "./zipExtractor.ts";

/**
 * Dependency bag injected into `createProcessUpload`.
 */
export interface ProcessUploadDeps {
  parseService: ParseService;
  actions: Pick<
    AppActions,
    | "startReading"
    | "startParsing"
    | "setProgress"
    | "partialParseSuccess"
    | "parseSuccess"
    | "fail"
  >;
  /** Active run ID ref used to abort stale upload sequences when a new upload begins. */
  activeRunIdRef: RefObject<number>;
  /** Ref holding the AbortController passed to the parse worker so it can be cancelled. */
  parseAbortControllerRef: RefObject<AbortController | null>;
  /** Called after each read batch completes; useful for instrumentation/logging. */
  onReadMeasured?: (fileCount: number) => void;
  /** Called once the first parse batch is dispatched. */
  onParseStarted?: () => void;
  /** Called after the final parse result is committed; useful for analytics. */
  onParseMeasured?: (
    data: { fileCount: number; nodeCount: number; edgeCount: number },
  ) => void;
  dialogueSearchMode?: DialogueSearchMode;
  parserVariant?: ParserVariant;
  customScreenActionRules?: ScreenActionRule[];

  // Real-time status callbacks
  onFilesDiscovered?: (files: UploadFileStatus[]) => void;
  onFileStatusUpdate?: (
    id: string,
    status: UploadFileStatus["status"],
    error?: string,
  ) => void;
}

/** Maximum number of files to read concurrently per read pass. */
const READ_BATCH_SIZE = 24;
/** Maximum number of files dispatched to the parse worker per chunk. */
const PARSE_BATCH_SIZE = 32;
/** Projects with at least this many .rpy files switch to the chunked parse strategy. */
const LARGE_PROJECT_THRESHOLD = 200;

/** Extracts the folder-relative path from a `File` or `UploadedFile`. */
function getFileRelativePath(file: File | UploadedFile): string | undefined {
  return file.webkitRelativePath
    ? file.webkitRelativePath.replace(/\\/g, "/")
    : undefined;
}

/** Deterministic sort comparator for uploaded files. */
function compareUploadFiles(a: UploadedFile, b: UploadedFile): number {
  const aIdentity = a.webkitRelativePath ?? a.name;
  const bIdentity = b.webkitRelativePath ?? b.name;
  return compareDeterministicStrings(aIdentity, bIdentity) ||
    compareDeterministicStrings(a.name, b.name);
}

/**
 * Factory function that creates a `processUpload` closure bound to the supplied
 * dependencies. The returned async function handles FileList and UploadedFile arrays,
 * decompresses ZIP files client-side, and tracks status.
 */
export function createProcessUpload(deps: ProcessUploadDeps) {
  const {
    parseService,
    actions,
    activeRunIdRef,
    parseAbortControllerRef,
    onReadMeasured,
    onParseStarted,
    onParseMeasured,
    dialogueSearchMode = "auto",
    parserVariant = "renpy",
    customScreenActionRules = [],
    onFilesDiscovered,
    onFileStatusUpdate,
  } = deps;

  return async function processUpload(
    files: FileList | UploadedFile[] | null,
  ): Promise<void> {
    if (!files || files.length === 0) {
      return;
    }

    const runId = (activeRunIdRef.current ?? 0) + 1;
    activeRunIdRef.current = runId;
    const isActiveRun = () => activeRunIdRef.current === runId;

    parseAbortControllerRef.current?.abort();
    parseAbortControllerRef.current = null;

    // Transition to reading early to show zip extraction/scanning status
    actions.startReading(0);

    const initialFiles: UploadedFile[] = Array.isArray(files)
      ? files
      : Array.from(files as FileList).map((f: File) => ({
        name: f.name,
        size: f.size,
        webkitRelativePath: getFileRelativePath(f),
        text: () => f.text(),
        arrayBuffer: () => f.arrayBuffer(),
        file: f,
      }));

    const consolidatedFiles: UploadedFile[] = [];
    try {
      for (const file of initialFiles) {
        if (!isActiveRun()) return;
        if (file.name.toLowerCase().endsWith(".zip")) {
          const extracted = await extractRpyFilesFromZip(file);
          consolidatedFiles.push(...extracted);
        } else {
          consolidatedFiles.push(file);
        }
      }
    } catch (err: unknown) {
      if (!isActiveRun()) return;
      actions.fail(toFileReadErrorMessage(err));
      return;
    }

    if (!isActiveRun()) return;

    const { rpyFiles, errorMessage } = validateRpyUpload(consolidatedFiles);
    if (errorMessage) {
      const err = new UploadValidationError(errorMessage);
      actions.fail(err.message);
      return;
    }

    const orderedRpyFiles = [...rpyFiles].sort(compareUploadFiles);
    const controller = new AbortController();
    parseAbortControllerRef.current = controller;

    actions.startReading(orderedRpyFiles.length);

    // Broadcast discovered files to the UI
    const getFileId = (f: UploadedFile, index: number) =>
      f.webkitRelativePath || `${f.name}#${index}`;

    const fileStatuses: UploadFileStatus[] = orderedRpyFiles.map((f, idx) => ({
      id: getFileId(f, idx),
      name: f.name,
      size: f.size,
      relativePath: f.webkitRelativePath,
      status: "pending",
    }));
    onFilesDiscovered?.(fileStatuses);

    let parsedNodes: FlowNode[] = [];
    let parsedEdges: FlowEdge[] = [];
    let parsedDiagnostics: ParseDiagnosticPayload[] = [];
    let hasStartedParsing = false;

    try {
      const shouldUseChunking =
        orderedRpyFiles.length >= LARGE_PROJECT_THRESHOLD;
      const effectiveDialogueMode =
        dialogueSearchMode === "auto" && shouldUseChunking
          ? "countOnly"
          : dialogueSearchMode;
      const shouldCaptureDialogueLines = effectiveDialogueMode !== "countOnly";
      let readCount = 0;
      let parsedFileCount = 0;

      for (
        let offset = 0;
        offset < orderedRpyFiles.length;
        offset += READ_BATCH_SIZE
      ) {
        if (!isActiveRun()) return;
        const batch = orderedRpyFiles.slice(offset, offset + READ_BATCH_SIZE);

        const inputs = await Promise.all(
          batch.map(async (f, bIdx) => {
            const fileIdx = offset + bIdx;
            const id = getFileId(f, fileIdx);
            try {
              onFileStatusUpdate?.(id, "reading");
              let content: Uint8Array;
              if (f.file) {
                const buf = await readFileAsArrayBuffer(f.file);
                content = new Uint8Array(buf);
              } else if (f.arrayBuffer) {
                const buf = await f.arrayBuffer();
                content = new Uint8Array(buf);
              } else {
                const text = await f.text();
                content = new TextEncoder().encode(text);
              }
              return {
                name: f.name,
                relativePath: f.webkitRelativePath,
                content,
              };
            } catch (err) {
              onFileStatusUpdate?.(
                id,
                "error",
                `Failed to read: ${
                  err instanceof Error ? err.message : String(err)
                }`,
              );
              throw err;
            }
          }),
        );

        readCount += inputs.length;
        onReadMeasured?.(readCount);
        if (!isActiveRun()) return;

        // Mark read files as parsing
        batch.forEach((f, bIdx) => {
          const id = getFileId(f, offset + bIdx);
          onFileStatusUpdate?.(id, "parsing");
        });

        try {
          const parseChunkSize = shouldUseChunking
            ? PARSE_BATCH_SIZE
            : inputs.length;
          const isLastReadBatch =
            offset + batch.length >= orderedRpyFiles.length;

          for (
            let parseOffset = 0;
            parseOffset < inputs.length;
            parseOffset += parseChunkSize
          ) {
            if (!isActiveRun()) return;
            if (!hasStartedParsing) {
              hasStartedParsing = true;
              onParseStarted?.();
              actions.startParsing();
            }

            const parseChunk = inputs.slice(
              parseOffset,
              parseOffset + parseChunkSize,
            );
            const chunkFiles = batch.slice(
              parseOffset,
              parseOffset + parseChunkSize,
            );
            const isLastParseChunkInBatch =
              parseOffset + parseChunk.length >= inputs.length;
            const isLastChunk = isLastReadBatch && isLastParseChunkInBatch;
            const baseCount = parsedFileCount;

            const result = await parseService.parse({
              files: parseChunk,
              appendToActiveGraph: true,
              resetActiveGraph: offset === 0 && parseOffset === 0,
              isFinalChunk: isLastChunk,
              captureDialogueLines: shouldCaptureDialogueLines,
              deferDetails: shouldUseChunking ||
                effectiveDialogueMode === "countOnly",
              parserVariant,
              screenActionRules: customScreenActionRules,
              signal: controller.signal,
              maxParallelFiles: typeof navigator !== "undefined"
                ? navigator.hardwareConcurrency
                : 4,
              onProgress: (progress) => {
                if (!isActiveRun()) return;
                actions.setProgress({
                  doneFiles: Math.min(
                    baseCount + progress.doneFiles,
                    orderedRpyFiles.length,
                  ),
                  totalFiles: orderedRpyFiles.length,
                  currentFile: progress.currentFile,
                });

                // Update individual progress for chunk files
                for (let i = 0; i < chunkFiles.length; i++) {
                  const f = chunkFiles[i]!;
                  const id = getFileId(f, offset + parseOffset + i);
                  const rawId = f.webkitRelativePath || f.name;
                  if (rawId === progress.currentFile) {
                    onFileStatusUpdate?.(id, "parsing");
                  } else if (i < progress.doneFiles) {
                    onFileStatusUpdate?.(id, "done");
                  }
                }
              },
              onPartialResult: (partial) => {
                if (!isActiveRun()) return;
                parsedNodes = partial.nodes;
                parsedEdges = partial.edges;
                parsedDiagnostics = partial.diagnostics ?? parsedDiagnostics;
                actions.partialParseSuccess(
                  parsedNodes,
                  parsedEdges,
                  parsedDiagnostics,
                );
              },
            });

            parsedNodes = result.nodes;
            parsedEdges = result.edges;
            parsedDiagnostics = result.diagnostics ?? parsedDiagnostics;
            parsedFileCount += parseChunk.length;
            if (!shouldUseChunking) {
              actions.partialParseSuccess(
                parsedNodes,
                parsedEdges,
                parsedDiagnostics,
              );
            }

            // Mark all files in this chunk as successfully completed
            chunkFiles.forEach((f, cIdx) => {
              const id = getFileId(f, offset + parseOffset + cIdx);
              onFileStatusUpdate?.(id, "done");
            });
          }
        } catch (err: unknown) {
          if (!isActiveRun()) return;
          // Mark files currently in batch as error
          batch.forEach((f, bIdx) => {
            const id = getFileId(f, offset + bIdx);
            onFileStatusUpdate?.(id, "error", String(err));
          });
          actions.fail(toParseErrorMessage(err));
          return;
        }
      }
    } catch (err: unknown) {
      if (!isActiveRun()) return;
      actions.fail(toFileReadErrorMessage(err));
      return;
    }

    if (!isActiveRun()) return;
    onParseMeasured?.({
      fileCount: orderedRpyFiles.length,
      nodeCount: parsedNodes.length,
      edgeCount: parsedEdges.length,
    });
    actions.parseSuccess(parsedNodes, parsedEdges, parsedDiagnostics);
  };
}
