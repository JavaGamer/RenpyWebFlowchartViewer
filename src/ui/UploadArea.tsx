import React, { useCallback, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { AlertCircle, ChevronDown, ChevronUp } from "lucide-react";
import { UploadDropzone } from "./components/UploadDropzone.tsx";
import { UploadProgress } from "./components/UploadProgress.tsx";
import { UrlImportForm } from "./components/UrlImportForm.tsx";
import ParserSettingsSection from "./ParserSettingsSection.tsx";
import type { FlowNode } from "../domain/index.ts";
import {
  type DebugBundlePrivacyOptions,
  fetchFilesFromUrl,
  traverseDataTransferItems,
  type UploadedFile,
  type UploadFileStatus,
  useAppStore,
  useDebugBundle,
  useParserRuleSettingsStore,
  useUploadOrchestrator,
  useViewerStore,
} from "../application/index.ts";
import { cn } from "./utils/cn.ts";
import {
  getParserVariantPlugins,
  type ParserVariant,
  type ParserVariantPlugin,
  type ScreenActionRule,
} from "../config/parserRules.ts";
import {
  MAX_RPY_FILE_COUNT,
  MAX_TOTAL_RPY_SIZE_BYTES,
} from "../config/uploadLimits.ts";

export interface UploadAreaProps {
  phase?: string;
  fileCount?: number;
  parseProgress?:
    | { doneFiles: number; totalFiles: number; currentFile?: string }
    | null;
  flowNodes?: FlowNode[];
  errorMsg?: string | null;
  debugPrivacyOptions?: DebugBundlePrivacyOptions;
  setDebugPrivacyOptions?: React.Dispatch<
    React.SetStateAction<DebugBundlePrivacyOptions>
  >;
  processFiles?: (files: FileList | UploadedFile[] | null) => Promise<void>;
  onCancelParsing?: () => void;
  onReset?: () => void;
  onExportDebugBundle?: (privacy: DebugBundlePrivacyOptions) => void;
  onOpenIssue?: (privacy: DebugBundlePrivacyOptions) => void;
  uploadedFiles?: UploadFileStatus[];

  // ParserSettingsSection props
  selectedVariant?: ParserVariant;
  setSelectedVariant?: (variant: ParserVariant) => void;
  parserVariantPlugins?: ParserVariantPlugin[];
  resetParserRuleSettings?: () => void;
  selectedVariantCustomRules?: ScreenActionRule[];
  updateCustomRule?: (index: number, patch: Partial<ScreenActionRule>) => void;
  removeCustomRule?: (index: number, patch?: Partial<ScreenActionRule>) => void;
  addCustomRule?: () => void;
}

export default function UploadArea({
  phase: propPhase,
  fileCount: propFileCount,
  parseProgress: propParseProgress,
  flowNodes: propFlowNodes,
  errorMsg: propErrorMsg,
  debugPrivacyOptions: propDebugPrivacyOptions,
  setDebugPrivacyOptions: propSetDebugPrivacyOptions,
  processFiles: propProcessFiles,
  onCancelParsing: propOnCancelParsing,
  onReset: propOnReset,
  onExportDebugBundle: propOnExportDebugBundle,
  onOpenIssue: propOnOpenIssue,
  uploadedFiles: propUploadedFiles,
  selectedVariant: propSelectedVariant,
  setSelectedVariant: propSetSelectedVariant,
  parserVariantPlugins: propParserVariantPlugins,
  resetParserRuleSettings: propResetParserRuleSettings,
  selectedVariantCustomRules: propSelectedVariantCustomRules,
  updateCustomRule: propUpdateCustomRule,
  removeCustomRule: propRemoveCustomRule,
  addCustomRule: propAddCustomRule,
}: UploadAreaProps) {
  // App store
  const {
    phase: storePhase,
    fileCount: storeFileCount,
    parseProgress: storeParseProgress,
    flowNodes: storeFlowNodes,
    errorMsg: storeErrorMsg,
    reset: storeReset,
  } = useAppStore(
    useShallow((s) => ({
      phase: s.phase,
      fileCount: s.fileCount,
      parseProgress: s.parseProgress,
      flowNodes: s.flowNodes,
      errorMsg: s.errorMsg,
      reset: s.reset,
    })),
  );

  const phase = propPhase ?? storePhase;
  const fileCount = propFileCount ?? storeFileCount;
  const parseProgress = propParseProgress ?? storeParseProgress;
  const flowNodes = propFlowNodes ?? storeFlowNodes;
  const errorMsg = propErrorMsg ?? storeErrorMsg;

  // Upload orchestrator hook
  const orchestrator = useUploadOrchestrator();
  const uploadedFiles = propUploadedFiles ?? orchestrator.uploadedFiles;
  const processFiles = propProcessFiles ?? orchestrator.processFiles;
  const onCancelParsing = propOnCancelParsing ?? orchestrator.cancelParsing;

  // Debug bundle hook
  const debug = useDebugBundle();
  const debugPrivacyOptions = propDebugPrivacyOptions ??
    debug.debugPrivacyOptions;
  const setDebugPrivacyOptions = propSetDebugPrivacyOptions ??
    debug.setDebugPrivacyOptions;
  const onExportDebugBundle = propOnExportDebugBundle ??
    debug.exportDebugBundle;
  const onOpenIssue = propOnOpenIssue ?? debug.openNewIssue;

  // Parser settings store
  const settings = useParserRuleSettingsStore();
  const selectedVariant = propSelectedVariant ?? settings.selectedVariant;
  const setSelectedVariant = propSetSelectedVariant ??
    settings.setSelectedVariant;
  const resetParserRuleSettings = propResetParserRuleSettings ??
    settings.resetSettings;
  const customRulesByVariant = settings.customRulesByVariant;
  const selectedVariantCustomRules = propSelectedVariantCustomRules ??
    (customRulesByVariant[selectedVariant] ?? []);

  const updateCustomRule = propUpdateCustomRule ?? settings.updateCustomRule;
  const removeCustomRule = propRemoveCustomRule ?? settings.removeCustomRule;
  const addCustomRule = propAddCustomRule ?? settings.addCustomRule;

  const parserVariantPlugins = propParserVariantPlugins ??
    getParserVariantPlugins();

  const onReset = propOnReset ?? (() => {
    orchestrator.setUploadedFiles([]);
    storeReset();
  });
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const filesInputRef = useRef<HTMLInputElement | null>(null);
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(true);
  const [importUrl, setImportUrl] = useState("");
  const [isFetchingUrl, setIsFetchingUrl] = useState(false);
  const [urlError, setUrlError] = useState<string | null>(null);

  const theme = useViewerStore((s) => s.theme);
  const isDark = theme === "dark";

  const handleUrlSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!importUrl.trim()) return;

      setIsFetchingUrl(true);
      setUrlError(null);

      fetchFilesFromUrl(importUrl)
        .then((files) => {
          setIsFetchingUrl(false);
          setImportUrl("");
          void processFiles(files);
        })
        .catch((err: unknown) => {
          setIsFetchingUrl(false);
          setUrlError(err instanceof Error ? err.message : String(err));
        });
    },
    [importUrl, processFiles],
  );

  const openFolderPicker = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const input = folderInputRef.current;
    if (!input) return;
    input.value = "";
    input.click();
  }, []);

  const openFilesPicker = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const input = filesInputRef.current;
    if (!input) return;
    input.value = "";
    input.click();
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLLabelElement>) => {
      e.preventDefault();
      e.stopPropagation();
      if (phase === "reading" || phase === "parsing") return;

      const fallbackFiles = e.dataTransfer.files;
      if (e.dataTransfer.items) {
        traverseDataTransferItems(e.dataTransfer.items)
          .then((rpyFiles) => {
            void processFiles(rpyFiles);
          })
          .catch((err) => {
            console.error("Error traversing dropped items:", err);
            void processFiles(fallbackFiles);
          });
      } else {
        void processFiles(fallbackFiles);
      }
    },
    [processFiles, phase],
  );

  const onDragOver = useCallback((e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
  }, []);

  const totalSizeMiB = Math.round(MAX_TOTAL_RPY_SIZE_BYTES / (1024 * 1024));
  const statusMessage = phase === "idle"
    ? `Step 1 of 3 — Select a project folder or ZIP archive with up to ${MAX_RPY_FILE_COUNT} .rpy files (${totalSizeMiB} MiB total).`
    : phase === "reading"
    ? "Step 2 of 3 — Reading selected files locally in your browser."
    : phase === "parsing"
    ? "Step 3 of 3 — Parsing scripts and building graph nodes and edges."
    : phase === "error"
    ? "Import failed. Review the guidance below, then choose folder/files again."
    : phase === "done" && flowNodes.length === 0
    ? "Import completed, but no labels or menus were found."
    : phase === "done"
    ? "Import complete. You can now explore, filter, and export the graph."
    : "";

  // Progress calculations
  const doneFiles = parseProgress?.doneFiles ?? 0;
  const totalFiles = parseProgress?.totalFiles ?? fileCount;
  const progressPercent = totalFiles > 0
    ? Math.round((doneFiles / totalFiles) * 100)
    : 0;

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8">
      <div className="w-full max-w-xl">
        <div
          className={cn(
            "mb-3 text-xs rounded-xl px-3 py-2 border transition-colors duration-200",
            isDark
              ? "text-slate-300 bg-slate-900 border-slate-800"
              : "text-gray-600 bg-white border-gray-200",
          )}
          role="status"
          aria-live="polite"
          aria-busy={phase === "reading" || phase === "parsing"}
          aria-atomic="true"
        >
          {statusMessage}
        </div>

        {/* Drop zone */}
        {(phase === "reading" || phase === "parsing")
          ? (
            <UploadProgress
              isDark={isDark}
              phase={phase}
              fileCount={fileCount}
              doneFiles={doneFiles}
              totalFiles={totalFiles}
              progressPercent={progressPercent}
              currentFile={parseProgress?.currentFile}
              uploadedFiles={uploadedFiles}
              onDrop={onDrop}
              onDragOver={onDragOver}
            />
          )
          : (
            <UploadDropzone
              isDark={isDark}
              openFilesPicker={openFilesPicker}
              onDrop={onDrop}
              onDragOver={onDragOver}
            />
          )}

        {/* Collapsible Advanced settings section */}
        {phase !== "reading" && phase !== "parsing" && (
          <div
            className={cn(
              "mt-4 border rounded-xl overflow-hidden transition-all duration-205 shadow-sm",
              isDark
                ? "border-slate-800 bg-slate-900"
                : "border-gray-200 bg-white",
            )}
          >
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setIsAdvancedOpen((prev) => !prev);
              }}
              className={cn(
                "w-full flex items-center justify-between px-4 py-3 text-xs font-semibold transition-colors focus:outline-none focus-visible:ring-2",
                isDark
                  ? "text-slate-200 hover:bg-slate-800/50 focus-visible:ring-violet-400"
                  : "text-gray-700 hover:bg-gray-50 focus-visible:ring-violet-500",
              )}
              aria-expanded={isAdvancedOpen}
              aria-controls="advanced-parser-settings"
            >
              <span className="flex items-center gap-1.5">
                Advanced Parser Settings
              </span>
              <span>
                {isAdvancedOpen
                  ? <ChevronUp size={14} />
                  : <ChevronDown size={14} />}
              </span>
            </button>

            {isAdvancedOpen && (
              <div
                id="advanced-parser-settings"
                className={cn(
                  "px-4 pb-4 border-t",
                  isDark ? "border-slate-800" : "border-gray-100",
                )}
              >
                <ParserSettingsSection
                  selectedVariant={selectedVariant}
                  setSelectedVariant={setSelectedVariant}
                  parserVariantPlugins={parserVariantPlugins}
                  resetParserRuleSettings={resetParserRuleSettings}
                  selectedVariantCustomRules={selectedVariantCustomRules}
                  updateCustomRule={updateCustomRule}
                  removeCustomRule={removeCustomRule}
                  addCustomRule={addCustomRule}
                />
              </div>
            )}
          </div>
        )}

        {/* Hidden file inputs */}
        <input
          id="folder-input"
          ref={folderInputRef}
          type="file"
          aria-label="Select Ren'Py project folder"
          className="hidden"
          // @ts-expect-error — webkitdirectory is non-standard but widely supported
          webkitdirectory=""
          directory=""
          multiple
          onChange={(e) => void processFiles(e.target.files)}
        />

        <input
          id="files-input"
          ref={filesInputRef}
          type="file"
          aria-label="Select Ren'Py script files or ZIP archive"
          className="hidden"
          multiple
          accept=".rpy,.zip"
          onChange={(e) => void processFiles(e.target.files)}
        />
        {(phase === "idle" || phase === "error") && (
          <UrlImportForm
            isDark={isDark}
            importUrl={importUrl}
            setImportUrl={setImportUrl}
            isFetchingUrl={isFetchingUrl}
            urlError={urlError}
            handleUrlSubmit={handleUrlSubmit}
          />
        )}

        {phase === "parsing" && (
          <div className="mt-4 flex justify-center">
            <button
              type="button"
              onClick={onCancelParsing}
              className="text-xs underline text-gray-600 hover:text-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 rounded"
              aria-label="Cancel parsing"
            >
              Cancel parsing
            </button>
          </div>
        )}

        {/* Error message */}
        {phase === "error" && (
          <div
            className={cn(
              "mt-4 flex flex-col items-start gap-3 p-4 rounded-xl border transition-colors duration-200",
              isDark
                ? "bg-red-950/40 border-red-900/60 text-red-300"
                : "bg-red-50 border-red-200 text-red-700",
            )}
          >
            <div className="flex flex-col sm:flex-row items-start gap-2">
              <AlertCircle
                size={18}
                className="shrink-0 mt-0.5"
                aria-hidden="true"
              />
              <div className="text-sm space-y-1">
                <p>{errorMsg}</p>
                <p
                  className={cn(
                    "text-xs",
                    isDark ? "text-red-400" : "text-red-800",
                  )}
                >
                  Next steps: confirm the folder contains valid{" "}
                  <code
                    className={cn(
                      "px-1 rounded",
                      isDark ? "bg-red-950/60" : "bg-red-100",
                    )}
                  >
                    .rpy
                  </code>{" "}
                  scripts or a valid ZIP, then retry.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={openFolderPicker}
                className={cn(
                  "text-xs px-2.5 py-1.5 rounded-md text-white focus-visible:outline-none focus-visible:ring-2",
                  isDark
                    ? "bg-red-800 hover:bg-red-700 focus-visible:ring-red-500"
                    : "bg-red-700 hover:bg-red-800 focus-visible:ring-red-500",
                )}
              >
                Try again
              </button>
              <button
                type="button"
                onClick={onReset}
                className={cn(
                  "text-xs underline focus-visible:outline-none focus-visible:ring-2 rounded",
                  isDark
                    ? "text-red-400 hover:text-red-300 focus-visible:ring-red-500"
                    : "text-red-700 hover:text-red-900 focus-visible:ring-red-500",
                )}
              >
                Start over
              </button>
              <button
                type="button"
                onClick={() => onExportDebugBundle(debugPrivacyOptions)}
                className={cn(
                  "text-xs px-2.5 py-1.5 rounded-md border focus-visible:outline-none focus-visible:ring-2",
                  isDark
                    ? "border-red-900 bg-slate-800 text-red-300 hover:bg-slate-700 focus-visible:ring-red-500"
                    : "border-red-300 bg-white text-red-700 hover:bg-red-100 focus-visible:ring-red-500",
                )}
              >
                Export Debug Bundle
              </button>
              <button
                type="button"
                onClick={() => onOpenIssue(debugPrivacyOptions)}
                className={cn(
                  "text-xs px-2.5 py-1.5 rounded-md border focus-visible:outline-none focus-visible:ring-2",
                  isDark
                    ? "border-red-900 bg-slate-800 text-red-300 hover:bg-slate-700 focus-visible:ring-red-500"
                    : "border-red-300 bg-white text-red-700 hover:bg-red-100 focus-visible:ring-red-500",
                )}
              >
                Open new GitHub issue
              </button>
            </div>
            <div
              className={cn(
                "w-full space-y-1 text-[11px]",
                isDark ? "text-red-400" : "text-red-900",
              )}
            >
              <label className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={debugPrivacyOptions.includeFileNames}
                  onChange={(event) => {
                    setDebugPrivacyOptions((prev) => ({
                      ...prev,
                      includeFileNames: event.target.checked,
                    }));
                  }}
                  className="rounded text-red-600 focus:ring-red-500"
                />
                Include file names (off by default because file names are
                sensitive)
              </label>
              <label className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={debugPrivacyOptions.includeRawScriptDetails}
                  onChange={(event) => {
                    setDebugPrivacyOptions((prev) => ({
                      ...prev,
                      includeRawScriptDetails: event.target.checked,
                    }));
                  }}
                  className="rounded text-red-600 focus:ring-red-500"
                />
                Include raw/script details (opt-in)
              </label>
              <label className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={debugPrivacyOptions.includeExtraDiagnostics}
                  onChange={(event) => {
                    setDebugPrivacyOptions((prev) => ({
                      ...prev,
                      includeExtraDiagnostics: event.target.checked,
                    }));
                  }}
                  className="rounded text-red-600 focus:ring-red-500"
                />
                Include extra diagnostics
              </label>
            </div>
          </div>
        )}

        {/* Empty result warning */}
        {phase === "done" && flowNodes.length === 0 && (
          <div
            className={cn(
              "mt-4 flex flex-col sm:flex-row items-start gap-2 p-4 rounded-xl border transition-colors duration-200",
              isDark
                ? "bg-amber-950/40 border-amber-900/60 text-amber-300"
                : "bg-amber-50 border-amber-200 text-amber-700",
            )}
          >
            <AlertCircle
              size={18}
              className="shrink-0 mt-0.5"
              aria-hidden="true"
            />
            <div className="text-sm space-y-1">
              <p>
                No labels or menus were found. Make sure the folder contains
                valid Ren'Py{" "}
                <code
                  className={cn(
                    "text-xs px-1 rounded",
                    isDark ? "bg-amber-950/80 text-amber-200" : "bg-amber-100",
                  )}
                >
                  .rpy
                </code>{" "}
                scripts.
              </p>
              <p
                className={cn(
                  "text-xs",
                  isDark ? "text-amber-400" : "text-amber-800",
                )}
              >
                Tip: try selecting the Ren'Py{" "}
                <code
                  className={cn(
                    "text-[11px] px-1 rounded",
                    isDark ? "bg-amber-950/80 text-amber-200" : "bg-amber-100",
                  )}
                >
                  game/
                </code>{" "}
                folder directly.
              </p>
            </div>
          </div>
        )}

        {/* Feature hints */}
        {phase !== "reading" && phase !== "parsing" && (
          <div
            className={cn(
              "mt-8 grid grid-cols-1 sm:grid-cols-2 gap-3 text-center text-xs transition-colors duration-200",
              isDark ? "text-slate-500" : "text-gray-400",
            )}
          >
            {[
              ["Labels", "Visualize every label block"],
              ["Menus", "See every choice menu"],
              ["Edges", "Jumps, calls & sequence flow"],
              ["Export", "Save chart as a PNG image"],
            ].map(([title, desc]) => (
              <div
                key={title}
                className={cn(
                  "rounded-xl p-3 transition-colors duration-200",
                  isDark
                    ? "bg-slate-900 border border-slate-800"
                    : "bg-white border border-gray-100 shadow-sm",
                )}
              >
                <p
                  className={cn(
                    "font-semibold mb-1",
                    isDark ? "text-slate-300" : "text-gray-600",
                  )}
                >
                  {title}
                </p>
                <p className={isDark ? "text-slate-400" : "text-gray-500"}>
                  {desc}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
