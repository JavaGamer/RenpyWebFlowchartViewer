import { useCallback, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useAppStore } from "./appStore.ts";
import { useParserRuleSettingsStore } from "./parserRuleSettingsStore.ts";
import { useTelemetryStore } from "./telemetryStore.ts";
import { createProcessUpload } from "./processUpload.ts";
import { createPerfTracker, preWarmLayoutWorker, workerParseService } from "../infrastructure/index.ts";
import type { UploadedFile, UploadFileStatus } from "./uploadTypes.ts";

export interface UseUploadOrchestratorResult {
  uploadedFiles: UploadFileStatus[];
  setUploadedFiles: React.Dispatch<React.SetStateAction<UploadFileStatus[]>>;
  processFiles: (files: FileList | UploadedFile[] | null) => Promise<void>;
  cancelParsing: () => void;
}

export function useUploadOrchestrator(): UseUploadOrchestratorResult {
  const perf = useMemo(() =>
    createPerfTracker("app", {
      onEvent: (event) => {
        const store = useTelemetryStore.getState();
        if (event.metric === "read_files_ms") {
          store.recordRead(event.ms);
          if (typeof event.detail?.files === "number") {
            store.setFileCount(event.detail.files);
          }
        } else if (event.metric === "parse_ms") {
          store.recordParse(
            event.ms,
            event.detail as { files?: number; nodes?: number; edges?: number },
          );
          if (typeof event.detail?.nodes === "number") {
            store.setGraphMetrics(
              event.detail.nodes as number,
              (event.detail.edges as number) ?? 0,
            );
          }
        } else if (event.metric === "layout_ms") {
          store.recordLayout(event.ms);
        } else if (event.metric === "render_commit_ms") {
          store.recordRender(event.ms);
        }
      },
    }), []);

  const dialogueSearchMode = useAppStore((s) => s.dialogueSearchMode);
  const appActions = useAppStore(
    useShallow((s) => ({
      reset: s.reset,
      startReading: s.startReading,
      startParsing: s.startParsing,
      setProgress: s.setProgress,
      partialParseSuccess: s.partialParseSuccess,
      parseSuccess: s.parseSuccess,
      setDialogueSearchMode: s.setDialogueSearchMode,
      fail: s.fail,
    })),
  );

  const { selectedVariant, customRulesByVariant } = useParserRuleSettingsStore(
    useShallow((s) => ({
      selectedVariant: s.selectedVariant,
      customRulesByVariant: s.customRulesByVariant,
    })),
  );

  const selectedVariantCustomRules = useMemo(
    () => customRulesByVariant[selectedVariant] ?? [],
    [customRulesByVariant, selectedVariant],
  );

  const parseAbortControllerRef = useRef<AbortController | null>(null);
  const activeRunIdRef = useRef(0);
  const [uploadedFiles, setUploadedFiles] = useState<UploadFileStatus[]>([]);

  const cancelParsing = useCallback(() => {
    parseAbortControllerRef.current?.abort();
  }, []);

  const processFiles = useCallback(
    async (files: FileList | UploadedFile[] | null) => {
      preWarmLayoutWorker();
      perf.mark("read");
      const process = createProcessUpload({
        parseService: workerParseService,
        actions: appActions,
        activeRunIdRef,
        parseAbortControllerRef,
        dialogueSearchMode,
        parserVariant: selectedVariant,
        customScreenActionRules: selectedVariantCustomRules,
        onReadMeasured: (fileCount) => {
          perf.measure("read", "read_files_ms", { files: fileCount });
        },
        onParseStarted: () => {
          perf.mark("parse");
        },
        onParseMeasured: ({ fileCount, nodeCount, edgeCount }) => {
          perf.measure("parse", "parse_ms", {
            files: fileCount,
            nodes: nodeCount,
            edges: edgeCount,
          });
        },
        onFilesDiscovered: (files) => {
          setUploadedFiles(files);
        },
        onFileStatusUpdate: (id, status, error) => {
          setUploadedFiles((prev) =>
            prev.map((f) => (f.id === id ? { ...f, status, error } : f))
          );
        },
      });
      await process(files);
    },
    [
      appActions,
      perf,
      selectedVariant,
      selectedVariantCustomRules,
      dialogueSearchMode,
    ],
  );

  return {
    uploadedFiles,
    setUploadedFiles,
    processFiles,
    cancelParsing,
  };
}
