import React, { useCallback, useRef } from 'react';
import { Upload, AlertCircle, Loader2 } from 'lucide-react';
import ParserSettingsSection from './ParserSettingsSection';
import type { FlowNode } from '../domain';
import type { DebugBundlePrivacyOptions } from '../application';
import type {
  ParserVariant,
  ParserVariantPlugin,
  ScreenActionRule,
} from '../config/parserRules';
import { MAX_RPY_FILE_COUNT, MAX_TOTAL_RPY_SIZE_BYTES } from '../config/uploadLimits';

export interface UploadAreaProps {
  phase: string;
  fileCount: number;
  parseProgress: { doneFiles: number; totalFiles: number; currentFile?: string } | null;
  flowNodes: FlowNode[];
  errorMsg: string | null;
  debugPrivacyOptions: DebugBundlePrivacyOptions;
  setDebugPrivacyOptions: React.Dispatch<React.SetStateAction<DebugBundlePrivacyOptions>>;
  processFiles: (files: FileList | null) => Promise<void>;
  onCancelParsing: () => void;
  onReset: () => void;
  onExportDebugBundle: (privacy: DebugBundlePrivacyOptions) => void;
  onOpenIssue: (privacy: DebugBundlePrivacyOptions) => void;

  // ParserSettingsSection props
  selectedVariant: ParserVariant;
  setSelectedVariant: (variant: ParserVariant) => void;
  parserVariantPlugins: ParserVariantPlugin[];
  resetParserRuleSettings: () => void;
  selectedVariantCustomRules: ScreenActionRule[];
  updateCustomRule: (index: number, patch: Partial<ScreenActionRule>) => void;
  removeCustomRule: (index: number) => void;
  addCustomRule: () => void;
}

export default function UploadArea({
  phase,
  fileCount,
  parseProgress,
  flowNodes,
  errorMsg,
  debugPrivacyOptions,
  setDebugPrivacyOptions,
  processFiles,
  onCancelParsing,
  onReset,
  onExportDebugBundle,
  onOpenIssue,
  selectedVariant,
  setSelectedVariant,
  parserVariantPlugins,
  resetParserRuleSettings,
  selectedVariantCustomRules,
  updateCustomRule,
  removeCustomRule,
  addCustomRule,
}: UploadAreaProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const openFolderPicker = useCallback(() => {
    const input = fileInputRef.current;
    if (!input) return;
    input.value = '';
    input.click();
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLLabelElement>) => {
      e.preventDefault();
      void processFiles(e.dataTransfer.files);
    },
    [processFiles],
  );

  const onDragOver = useCallback((e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
  }, []);

  const totalSizeMiB = Math.round(MAX_TOTAL_RPY_SIZE_BYTES / (1024 * 1024));
  const statusMessage =
    phase === 'idle'
      ? `Step 1 of 3 — Select a project folder with up to ${MAX_RPY_FILE_COUNT} .rpy files (${totalSizeMiB} MiB total).`
      : phase === 'reading'
        ? 'Step 2 of 3 — Reading selected files locally in your browser.'
        : phase === 'parsing'
          ? 'Step 3 of 3 — Parsing scripts and building graph nodes and edges.'
          : phase === 'error'
            ? 'Import failed. Review the guidance below, then choose a folder again.'
            : phase === 'done' && flowNodes.length === 0
              ? 'Import completed, but no labels or menus were found.'
              : phase === 'done'
                ? 'Import complete. You can now explore, filter, and export the graph.'
                : '';

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8">
      <div className="w-full max-w-xl">
        <div
          className="mb-3 text-xs text-gray-600 bg-white border border-gray-200 rounded-xl px-3 py-2"
          role="status"
          aria-live="polite"
          aria-busy={phase === 'reading' || phase === 'parsing'}
          aria-atomic="true"
        >
          {statusMessage}
        </div>
        {/* Drop zone */}
        <label
          htmlFor="folder-input"
          aria-label="Upload Ren'Py project folder"
          onDrop={onDrop}
          onDragOver={onDragOver}
          className="flex flex-col items-center justify-center gap-4 w-full min-h-64 rounded-2xl border-2 border-dashed border-violet-300 bg-white hover:bg-violet-50 hover:border-violet-400 transition-colors cursor-pointer p-5 sm:p-6"
        >
          {phase === 'reading' || phase === 'parsing' ? (
            <>
              <Loader2 size={40} className="text-violet-500 animate-spin" aria-hidden="true" />
              <p className="text-gray-600 font-medium">
                {phase === 'reading'
                  ? `Reading ${fileCount} .rpy file${fileCount !== 1 ? 's' : ''}…`
                  : `Parsing ${parseProgress?.doneFiles ?? 0} / ${parseProgress?.totalFiles ?? fileCount} .rpy file${(parseProgress?.totalFiles ?? fileCount) !== 1 ? 's' : ''}…`}
              </p>
              {parseProgress?.currentFile && (
                <p className="text-xs text-gray-500">Current: {parseProgress.currentFile}</p>
              )}
            </>
          ) : (
            <>
              <Upload size={40} className="text-violet-400" aria-hidden="true" />
              <div className="text-center">
                <p className="text-base font-semibold text-gray-700">
                  Drop your Ren'Py project folder here
                </p>
                <p className="text-sm text-gray-400 mt-1">or click to choose the folder</p>
              </div>
              <span className="text-xs text-gray-400 bg-gray-100 px-3 py-1 rounded-full">
                All processing is local — your files never leave your device
              </span>
            </>
          )}
        </label>

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

        {/* Hidden file input with directory support */}
        <input
          id="folder-input"
          ref={fileInputRef}
          type="file"
          aria-label="Select Ren'Py project folder"
          className="hidden"
          // @ts-expect-error — non-standard but widely supported attributes
          webkitdirectory=""
          directory=""
          multiple
          onChange={(e) => void processFiles(e.target.files)}
        />

        {phase === 'parsing' && (
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
        {phase === 'error' && (
          <div className="mt-4 flex flex-col items-start gap-3 p-4 rounded-xl bg-red-50 border border-red-200 text-red-700">
            <div className="flex flex-col sm:flex-row items-start gap-2">
              <AlertCircle size={18} className="shrink-0 mt-0.5" aria-hidden="true" />
              <div className="text-sm space-y-1">
                <p>{errorMsg}</p>
                <p className="text-xs text-red-800">
                  Next steps: confirm the folder contains valid{' '}
                  <code className="px-1 rounded bg-red-100">.rpy</code> scripts, then retry.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={openFolderPicker}
                className="text-xs px-2.5 py-1.5 rounded-md bg-red-700 text-white hover:bg-red-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
              >
                Try again
              </button>
              <button
                type="button"
                onClick={onReset}
                className="text-xs underline text-red-700 hover:text-red-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 rounded"
              >
                Start over
              </button>
              <button
                type="button"
                onClick={() => onExportDebugBundle(debugPrivacyOptions)}
                className="text-xs px-2.5 py-1.5 rounded-md border border-red-300 bg-white text-red-700 hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
              >
                Export Debug Bundle
              </button>
              <button
                type="button"
                onClick={() => onOpenIssue(debugPrivacyOptions)}
                className="text-xs px-2.5 py-1.5 rounded-md border border-red-300 bg-white text-red-700 hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
              >
                Open new GitHub issue
              </button>
            </div>
            <div className="w-full space-y-1 text-[11px] text-red-900">
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
                />
                Include file names (off by default because file names are sensitive)
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
                />
                Include extra diagnostics
              </label>
            </div>
          </div>
        )}

        {/* Empty result warning */}
        {phase === 'done' && flowNodes.length === 0 && (
          <div className="mt-4 flex flex-col sm:flex-row items-start gap-2 p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-700">
            <AlertCircle size={18} className="shrink-0 mt-0.5" aria-hidden="true" />
            <div className="text-sm space-y-1">
              <p>
                No labels or menus were found. Make sure the folder contains valid Ren'Py{' '}
                <code className="text-xs bg-amber-100 px-1 rounded">.rpy</code> scripts.
              </p>
              <p className="text-xs text-amber-800">
                Tip: try selecting the Ren'Py{' '}
                <code className="text-[11px] bg-amber-100 px-1 rounded">game/</code> folder
                directly.
              </p>
            </div>
          </div>
        )}

        {/* Feature hints */}
        <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-3 text-center text-xs text-gray-400">
          {[
            ['Labels', 'Visualize every label block'],
            ['Menus', 'See every choice menu'],
            ['Edges', 'Jumps, calls & sequence flow'],
            ['Export', 'Save chart as a PNG image'],
          ].map(([title, desc]) => (
            <div key={title} className="bg-white border border-gray-100 rounded-xl p-3">
              <p className="font-semibold text-gray-600 mb-1">{title}</p>
              <p>{desc}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
