import React, { useCallback, useRef, useState } from 'react';
import { Upload, AlertCircle, Loader2, ChevronDown, ChevronUp } from 'lucide-react';
import ParserSettingsSection from './ParserSettingsSection';
import type { FlowNode } from '../domain';
import {
  type DebugBundlePrivacyOptions,
  type UploadFileStatus,
  type UploadedFile,
  traverseDataTransferItems,
  fetchFilesFromUrl,
} from '../application';
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
  processFiles: (files: FileList | UploadedFile[] | null) => Promise<void>;
  onCancelParsing: () => void;
  onReset: () => void;
  onExportDebugBundle: (privacy: DebugBundlePrivacyOptions) => void;
  onOpenIssue: (privacy: DebugBundlePrivacyOptions) => void;
  uploadedFiles: UploadFileStatus[];

  // ParserSettingsSection props
  selectedVariant: ParserVariant;
  setSelectedVariant: (variant: ParserVariant) => void;
  parserVariantPlugins: ParserVariantPlugin[];
  resetParserRuleSettings: () => void;
  selectedVariantCustomRules: ScreenActionRule[];
  updateCustomRule: (index: number, patch: Partial<ScreenActionRule>) => void;
  removeCustomRule: (index: number, patch?: Partial<ScreenActionRule>) => void;
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
  uploadedFiles,
  selectedVariant,
  setSelectedVariant,
  parserVariantPlugins,
  resetParserRuleSettings,
  selectedVariantCustomRules,
  updateCustomRule,
  removeCustomRule,
  addCustomRule,
}: UploadAreaProps) {
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const filesInputRef = useRef<HTMLInputElement | null>(null);
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(true);
  const [importUrl, setImportUrl] = useState('');
  const [isFetchingUrl, setIsFetchingUrl] = useState(false);
  const [urlError, setUrlError] = useState<string | null>(null);

  const handleUrlSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!importUrl.trim()) return;

      setIsFetchingUrl(true);
      setUrlError(null);

      fetchFilesFromUrl(importUrl)
        .then((files) => {
          setIsFetchingUrl(false);
          setImportUrl('');
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
    input.value = '';
    input.click();
  }, []);

  const openFilesPicker = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const input = filesInputRef.current;
    if (!input) return;
    input.value = '';
    input.click();
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLLabelElement>) => {
      e.preventDefault();
      e.stopPropagation();
      if (phase === 'reading' || phase === 'parsing') return;

      if (e.dataTransfer.items) {
        traverseDataTransferItems(e.dataTransfer.items)
          .then((rpyFiles) => {
            void processFiles(rpyFiles);
          })
          .catch((err) => {
            console.error('Error traversing dropped items:', err);
            void processFiles(e.dataTransfer.files);
          });
      } else {
        void processFiles(e.dataTransfer.files);
      }
    },
    [processFiles, phase],
  );

  const onDragOver = useCallback((e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
  }, []);

  const totalSizeMiB = Math.round(MAX_TOTAL_RPY_SIZE_BYTES / (1024 * 1024));
  const statusMessage =
    phase === 'idle'
      ? `Step 1 of 3 — Select a project folder or ZIP archive with up to ${MAX_RPY_FILE_COUNT} .rpy files (${totalSizeMiB} MiB total).`
      : phase === 'reading'
        ? 'Step 2 of 3 — Reading selected files locally in your browser.'
        : phase === 'parsing'
          ? 'Step 3 of 3 — Parsing scripts and building graph nodes and edges.'
          : phase === 'error'
            ? 'Import failed. Review the guidance below, then choose folder/files again.'
            : phase === 'done' && flowNodes.length === 0
              ? 'Import completed, but no labels or menus were found.'
              : phase === 'done'
                ? 'Import complete. You can now explore, filter, and export the graph.'
                : '';

  // Progress calculations
  const doneFiles = parseProgress?.doneFiles ?? 0;
  const totalFiles = parseProgress?.totalFiles ?? fileCount;
  const progressPercent = totalFiles > 0 ? Math.round((doneFiles / totalFiles) * 100) : 0;

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
          className={`flex flex-col items-center justify-center gap-4 w-full min-h-64 rounded-2xl border-2 border-dashed border-violet-300 bg-white transition-all p-5 sm:p-6 select-none ${
            phase === 'reading' || phase === 'parsing'
              ? 'cursor-wait border-violet-200'
              : 'cursor-pointer hover:bg-violet-50/50 hover:border-violet-400'
          }`}
        >
          {phase === 'reading' || phase === 'parsing' ? (
            <div className="w-full flex flex-col items-center gap-4">
              <Loader2 size={40} className="text-violet-500 animate-spin" aria-hidden="true" />
              
              <div className="text-center w-full">
                <p className="text-sm font-semibold text-gray-700">
                  {phase === 'reading'
                    ? `Reading ${fileCount === 0 ? 'scanning...' : `${fileCount} file(s)...`}`
                    : `Parsing ${doneFiles} / ${totalFiles} .rpy files…`}
                </p>
                {parseProgress?.currentFile && (
                  <p className="text-xs text-gray-400 mt-1 truncate max-w-md mx-auto" title={parseProgress.currentFile}>
                    Current: {parseProgress.currentFile}
                  </p>
                )}
              </div>

              {/* Global Progress Bar */}
              <div className="w-full max-w-md bg-gray-100 rounded-full h-2 overflow-hidden mt-1 border border-gray-200/50">
                <div
                  className="bg-violet-600 h-2 rounded-full transition-all duration-300 animate-pulse"
                  style={{ width: `${progressPercent}%` }}
                ></div>
              </div>
              <span className="text-[10px] text-gray-400 font-semibold">{progressPercent}% Completed</span>

              {/* File-by-file Status Tracker */}
              {uploadedFiles.length > 0 && (
                <div className="w-full max-w-md mt-4 border border-gray-200/60 rounded-xl bg-gray-50/50 p-2.5 max-h-48 overflow-y-auto space-y-1.5 scrollbar-thin">
                  {uploadedFiles.map((file) => {
                    const sizeKB = (file.size / 1024).toFixed(1);
                    return (
                      <div
                        key={file.id}
                        className="flex items-center justify-between gap-3 p-2 bg-white border border-gray-150 rounded-lg shadow-sm text-[11px]"
                      >
                        <div className="min-w-0 flex-1 text-left">
                          <p className="font-semibold text-gray-700 truncate" title={file.name}>
                            {file.name}
                          </p>
                          {file.relativePath && (
                            <p className="text-[9px] text-gray-400 truncate" title={file.relativePath}>
                              {file.relativePath.substring(0, file.relativePath.lastIndexOf('/') + 1)}
                            </p>
                          )}
                        </div>
                        <div className="shrink-0 flex items-center gap-2">
                          <span className="text-[9px] text-gray-400">{sizeKB} KB</span>
                          <span
                            className={`px-1.5 py-0.5 rounded-full text-[9px] font-semibold tracking-wide border ${
                              file.status === 'pending'
                                ? 'bg-gray-50 text-gray-500 border-gray-200'
                                : file.status === 'reading'
                                  ? 'bg-blue-50 text-blue-700 border-blue-200 animate-pulse'
                                  : file.status === 'parsing'
                                    ? 'bg-violet-50 text-violet-700 border-violet-200 animate-pulse'
                                    : file.status === 'done'
                                      ? 'bg-green-50 text-green-700 border-green-200'
                                      : 'bg-red-50 text-red-700 border-red-200'
                            }`}
                            title={file.error}
                          >
                            {file.status.toUpperCase()}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Large project warning */}
              {totalFiles >= 200 && (
                <div className="w-full max-w-md mt-3 flex items-start gap-2 p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-[11px] text-left shadow-sm">
                  <AlertCircle size={16} className="shrink-0 mt-0.5" aria-hidden="true" />
                  <div>
                    <p className="font-semibold">Large project warning ({totalFiles} files)</p>
                    <p className="mt-0.5 text-[10px] text-amber-700">
                      Generating flowchart layout may take a few moments. We've automatically activated performance mode (label/count search only) to optimize speed.
                    </p>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <>
              <Upload size={40} className="text-violet-400 animate-bounce" aria-hidden="true" />
              <div className="text-center px-4">
                <p className="text-base font-semibold text-gray-700">
                  Drop your Ren'Py project folder here
                </p>
                <p className="text-sm text-gray-400 mt-2">
                  or click to{' '}
                  <span
                    className="text-violet-600 font-semibold hover:text-violet-800 underline cursor-pointer px-1"
                  >
                    select a folder
                  </span>{' '}
                  or{' '}
                  <button
                    type="button"
                    onClick={openFilesPicker}
                    className="text-violet-600 font-semibold hover:text-violet-800 underline focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 rounded px-1"
                  >
                    select files/ZIP
                  </button>
                </p>
              </div>
              <span className="text-xs text-gray-400 bg-gray-100 px-3 py-1 rounded-full">
                All processing is local — your files never leave your device
              </span>
            </>
          )}
        </label>

        {/* Collapsible Advanced settings section */}
        {phase !== 'reading' && phase !== 'parsing' && (
          <div className="mt-4 border border-gray-200 rounded-xl bg-white overflow-hidden transition-all duration-200 shadow-sm">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setIsAdvancedOpen((prev) => !prev);
              }}
              className="w-full flex items-center justify-between px-4 py-3 text-xs font-semibold text-gray-700 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 transition-colors"
              aria-expanded={isAdvancedOpen}
              aria-controls="advanced-parser-settings"
            >
              <span className="flex items-center gap-1.5">
                Advanced Parser Settings
              </span>
              <span>
                {isAdvancedOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </span>
            </button>

            {isAdvancedOpen && (
              <div id="advanced-parser-settings" className="px-4 pb-4 border-t border-gray-100">
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

        {/* Import from URL */}
        {(phase === 'idle' || phase === 'error') && (
          <div className="mt-4 border border-gray-200 rounded-xl bg-white p-4 shadow-sm text-xs text-gray-700">
            <h3 className="font-semibold text-gray-900 mb-2">Or Import from Public URL</h3>
            <form onSubmit={handleUrlSubmit} className="flex gap-2">
              <input
                type="text"
                required
                disabled={isFetchingUrl}
                placeholder="Enter .rpy file, .zip URL, or GitHub repo (e.g., github.com/owner/repo)"
                value={importUrl}
                onChange={(e) => setImportUrl(e.target.value)}
                className="flex-1 rounded-md border border-gray-300 px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-violet-500 bg-white"
              />
              <button
                type="submit"
                disabled={isFetchingUrl}
                className="rounded-md bg-violet-600 px-3 py-1.5 text-white font-semibold hover:bg-violet-700 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 disabled:bg-violet-400"
              >
                {isFetchingUrl ? 'Loading...' : 'Import'}
              </button>
            </form>
            {urlError && (
              <p className="mt-2 text-[11px] text-red-650 font-semibold" role="alert">
                {urlError}
              </p>
            )}
            <p className="mt-2 text-[10px] text-gray-400">
              Note: Remote hosts must support CORS. GitHub repositories and raw.githubusercontent.com files are fully supported.
            </p>
          </div>
        )}

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
                  <code className="px-1 rounded bg-red-100">.rpy</code> scripts or a valid ZIP, then retry.
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
        {phase !== 'reading' && phase !== 'parsing' && (
          <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-3 text-center text-xs text-gray-400">
            {[
              ['Labels', 'Visualize every label block'],
              ['Menus', 'See every choice menu'],
              ['Edges', 'Jumps, calls & sequence flow'],
              ['Export', 'Save chart as a PNG image'],
            ].map(([title, desc]) => (
              <div key={title} className="bg-white border border-gray-100 rounded-xl p-3 shadow-sm">
                <p className="font-semibold text-gray-600 mb-1">{title}</p>
                <p>{desc}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
