/**
 * src/App.tsx
 *
 * Root application component.
 *
 * Provides a directory-upload interface that reads .rpy files via the
 * browser's FileReader API (no server round-trips), passes them to the
 * Ren'Py parser, and renders the resulting flowchart.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Upload, FolderOpen, AlertCircle, Loader2 } from 'lucide-react';
import { saveAs } from 'file-saver';
import { FlowchartViewer } from './ui';
import { createPerfTracker } from './perf';
import {
  useAppStore,
  useParserRuleSettingsStore,
  buildDebugBundle,
  buildIssueDraftUrl,
  workerParseService,
  createProcessUpload,
  DEFAULT_DEBUG_BUNDLE_PRIVACY_OPTIONS,
  toDebugBundleBlob,
  type DebugBundlePrivacyOptions,
} from './application';
import { MAX_RPY_FILE_COUNT, MAX_TOTAL_RPY_SIZE_BYTES } from './config/uploadLimits';
import {
  PARSER_VARIANTS,
  type ParserVariant,
  type ScreenActionKind,
} from './config/parserRules';

// ─── Component ────────────────────────────────────────────────────────────────

export default function App() {
  const perf = useMemo(() => createPerfTracker('app'), []);

  // ── App state (Zustand store) ───────────────────────────────────────────────
  const phase = useAppStore((s) => s.phase);
  const flowNodes = useAppStore((s) => s.flowNodes);
  const flowEdges = useAppStore((s) => s.flowEdges);
  const parseWarnings = useAppStore((s) => s.parseWarnings);
  const errorMsg = useAppStore((s) => s.errorMsg);
  const fileCount = useAppStore((s) => s.fileCount);
  const parseProgress = useAppStore((s) => s.parseProgress);
  const importRevision = useAppStore((s) => s.importRevision);
  const dialogueSearchMode = useAppStore((s) => s.dialogueSearchMode);
  const appActions = useAppStore(useShallow((s) => ({
    reset: s.reset,
    startReading: s.startReading,
    startParsing: s.startParsing,
    setProgress: s.setProgress,
    partialParseSuccess: s.partialParseSuccess,
    parseSuccess: s.parseSuccess,
    setDialogueSearchMode: s.setDialogueSearchMode,
    fail: s.fail,
  })));

  // ── Parser settings (Zustand persist store) ─────────────────────────────────
  const selectedVariant = useParserRuleSettingsStore((s) => s.selectedVariant);
  const customRulesByVariant = useParserRuleSettingsStore((s) => s.customRulesByVariant);
  const setSelectedVariant = useParserRuleSettingsStore((s) => s.setSelectedVariant);
  const addCustomRule = useParserRuleSettingsStore((s) => s.addCustomRule);
  const updateCustomRule = useParserRuleSettingsStore((s) => s.updateCustomRule);
  const removeCustomRule = useParserRuleSettingsStore((s) => s.removeCustomRule);
  const resetParserRuleSettings = useParserRuleSettingsStore((s) => s.resetSettings);
  const selectedVariantCustomRules = customRulesByVariant[selectedVariant];

  const [debugPrivacyOptions, setDebugPrivacyOptions] = useState<DebugBundlePrivacyOptions>(
    DEFAULT_DEBUG_BUNDLE_PRIVACY_OPTIONS,
  );
  const parseAbortControllerRef = useRef<AbortController | null>(null);
  const activeRunIdRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // ── Process selected files ─────────────────────────────────────────────────
  const processFilesWithPerf = useCallback(
    async (files: FileList | null) => {
      perf.mark('read');
      const processFiles = createProcessUpload({
        parseService: workerParseService,
        actions: appActions,
        activeRunIdRef,
        parseAbortControllerRef,
        dialogueSearchMode,
        parserVariant: selectedVariant,
        customScreenActionRules: selectedVariantCustomRules,
        onReadMeasured: (fileCount) => {
          perf.measure('read', 'read_files_ms', { files: fileCount });
        },
        onParseStarted: () => {
          perf.mark('parse');
        },
        onParseMeasured: ({ fileCount, nodeCount, edgeCount }) => {
          perf.measure('parse', 'parse_ms', { files: fileCount, nodes: nodeCount, edges: edgeCount });
        },
      });
      await processFiles(files);
    },
    [appActions, perf, selectedVariant, selectedVariantCustomRules, dialogueSearchMode],
  );

  const appVersion = import.meta.env.VITE_APP_VERSION ?? '0.0.0';
  const exportDebugBundle = useCallback((privacy: DebugBundlePrivacyOptions) => {
    const bundle = buildDebugBundle({
      appVersion,
      state: {
        phase,
        fileCount,
        importRevision,
        dialogueSearchMode,
        errorMsg,
        parseProgress,
      },
      parser: {
        selectedVariant,
        customScreenActionRules: selectedVariantCustomRules,
      },
      graph: {
        flowNodes,
        flowEdges,
      },
      parseWarnings,
      privacy,
    });
    saveAs(toDebugBundleBlob(bundle), 'renpy-flowchart-debug-bundle.json');
  }, [
    appVersion,
    selectedVariant,
    selectedVariantCustomRules,
    dialogueSearchMode,
    errorMsg,
    fileCount,
    flowEdges,
    flowNodes,
    importRevision,
    parseProgress,
    parseWarnings,
    phase,
  ]);
  const openNewIssue = useCallback((privacy: DebugBundlePrivacyOptions) => {
    const issueUrl = buildIssueDraftUrl({
      owner: 'JavaGamer',
      repo: 'RenpyWebFlowchartViewer',
      privacy,
      state: {
        phase,
        dialogueSearchMode,
        selectedVariant,
        fileCount,
        warningCount: parseWarnings.length,
      },
    });
    if (typeof globalThis.open !== 'function') return;
    globalThis.open(issueUrl, '_blank', 'noopener,noreferrer');
  }, [
    selectedVariant,
    dialogueSearchMode,
    fileCount,
    parseWarnings.length,
    phase,
  ]);

  // ── Drag-and-drop support ──────────────────────────────────────────────────
  const onDrop = useCallback(
    (e: React.DragEvent<HTMLLabelElement>) => {
      e.preventDefault();
      void processFilesWithPerf(e.dataTransfer.files);
    },
    [processFilesWithPerf],
  );

  const onDragOver = (e: React.DragEvent<HTMLLabelElement>) => e.preventDefault();
  const openFolderPicker = useCallback(() => {
    const input = fileInputRef.current;
    if (!input) return;
    input.value = '';
    input.click();
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

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full min-h-screen bg-gray-50 font-sans">
      <a
        href="#flowchart-main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:text-violet-700 focus:shadow"
      >
        Skip to flowchart
      </a>
      {/* Header */}
      <header className="shrink-0 bg-white border-b border-gray-200 px-4 sm:px-6 py-4 flex flex-wrap items-center gap-2 sm:gap-3 shadow-sm">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-8 h-8 bg-violet-600 rounded-lg flex items-center justify-center">
            <FolderOpen size={16} className="text-white" />
          </div>
          <h1 className="text-base sm:text-lg font-bold text-gray-900 tracking-tight truncate">
            Ren'Py Flowchart Viewer
          </h1>
        </div>
          <span className="w-full sm:w-auto text-xs text-gray-700 sm:ml-2 text-center sm:text-left">
            Upload a Ren'Py project folder to visualize script structure, search dialogue, and export flowcharts
          </span>
        </header>

      {/* Main content */}
      {phase === 'done' && flowNodes.length > 0 ? (
        /* ── Flowchart view ─────────────────────────────────────────────── */
        <main id="flowchart-main" className="flex-1 flex flex-col overflow-hidden" aria-label="Flowchart viewer">
          {/* Re-upload button */}
          <div className="shrink-0 bg-violet-50 border-b border-violet-100 px-4 py-2 flex flex-wrap items-center gap-2 sm:gap-3 text-sm text-violet-700">
            <span>
              Parsed <strong>{fileCount}</strong> .rpy file
              {fileCount !== 1 ? 's' : ''} →{' '}
              <strong>{flowNodes.length}</strong> nodes,{' '}
              <strong>{flowEdges.length}</strong> edges
            </span>
            {parseWarnings.length > 0 && (
              <span className="text-xs font-semibold rounded-full bg-amber-100 text-amber-800 px-2 py-0.5">
                {parseWarnings.length} parse warning{parseWarnings.length === 1 ? '' : 's'}
              </span>
            )}
            <button
              onClick={() => {
                appActions.reset();
              }}
              className="sm:ml-auto text-xs underline text-violet-600 hover:text-violet-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 rounded"
            >
              Upload a different folder
            </button>
          </div>
          {parseWarnings.length > 0 && (
            <section
              className="shrink-0 border-b border-amber-200 bg-amber-50 px-4 py-3 text-amber-900"
              aria-label="Parser warnings"
            >
              <p className="text-sm font-semibold">Parser warnings</p>
              <ul className="mt-1 list-disc pl-5 text-xs space-y-1">
                {parseWarnings.map((warning, idx) => (
                  <li key={`${warning.chapter}-${warning.construct}-${warning.targetExpression}-${idx}`}>
                    <span className="font-medium">{warning.construct}</span> in <span className="font-medium">{warning.chapter}</span>: {warning.message}
                  </li>
                ))}
              </ul>
            </section>
          )}
          <FlowchartViewer
            key={importRevision}
            flowNodes={flowNodes}
            flowEdges={flowEdges}
            dialogueSearchMode={dialogueSearchMode}
            onDialogueSearchModeChange={(mode) => appActions.setDialogueSearchMode(mode)}
            debugPrivacyOptions={debugPrivacyOptions}
            onDebugPrivacyOptionsChange={setDebugPrivacyOptions}
            onExportDebugBundle={exportDebugBundle}
            onOpenIssue={openNewIssue}
          />
        </main>
      ) : (
        /* ── Upload area ─────────────────────────────────────────────────── */
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
                    <p className="text-sm text-gray-400 mt-1">
                      or click to choose the folder
                    </p>
                  </div>
                  <span className="text-xs text-gray-400 bg-gray-100 px-3 py-1 rounded-full">
                    All processing is local — your files never leave your device
                  </span>
                </>
              )}
            </label>

            <section className="mt-4 rounded-xl border border-gray-200 bg-white p-4 text-xs text-gray-700">
              <div className="flex flex-wrap items-center gap-2">
                <label htmlFor="parser-variant" className="font-semibold text-gray-900">
                  Parser variant
                </label>
                <select
                  id="parser-variant"
                  aria-label="Parser variant"
                  value={selectedVariant}
                  onChange={(event) => setSelectedVariant(event.target.value as ParserVariant)}
                  className="rounded-md border border-gray-300 px-2 py-1 text-xs bg-white"
                >
                  {PARSER_VARIANTS.map((variant) => (
                    <option key={variant} value={variant}>
                      {variant.toUpperCase()}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="ml-auto text-[11px] underline text-gray-500 hover:text-gray-700"
                  onClick={resetParserRuleSettings}
                >
                  Reset variant + custom rules
                </button>
              </div>
              <p className="mt-2 text-[11px] text-gray-500">
                Custom screen-action rules are stored in your browser and reused across project imports.
              </p>
              <div className="mt-3 space-y-2" aria-label="Custom screen action rules">
                {selectedVariantCustomRules.map((rule, idx) => (
                  <div key={`${selectedVariant}-rule-${idx}`} className="flex flex-wrap items-center gap-2">
                    <input
                      aria-label={`Custom rule action ${idx + 1}`}
                      value={rule.actionName}
                      onChange={(event) => updateCustomRule(idx, { actionName: event.target.value })}
                      className="min-w-36 flex-1 rounded-md border border-gray-300 px-2 py-1 text-xs"
                      placeholder="action name"
                    />
                    <select
                      aria-label={`Custom rule action type ${idx + 1}`}
                      value={rule.actionKind}
                      onChange={(event) => updateCustomRule(idx, { actionKind: event.target.value as ScreenActionKind })}
                      className="rounded-md border border-gray-300 px-2 py-1 text-xs bg-white"
                    >
                      <option value="jump">jump</option>
                      <option value="call">call</option>
                    </select>
                    <button
                      type="button"
                      aria-label={`Remove custom rule ${idx + 1}`}
                      className="rounded-md border border-gray-300 px-2 py-1 text-[11px] text-gray-600 hover:bg-gray-50"
                      onClick={() => removeCustomRuleCb(idx)}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={addCustomRuleCb}
                className="mt-3 rounded-md border border-violet-300 px-2 py-1 text-[11px] text-violet-700 hover:bg-violet-50"
              >
                Add custom rule
              </button>
            </section>

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
              onChange={(e) => void processFilesWithPerf(e.target.files)}
            />

             {phase === 'parsing' && (
               <div className="mt-4 flex justify-center">
                 <button
                  type="button"
                   onClick={() => parseAbortControllerRef.current?.abort()}
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
                      Next steps: confirm the folder contains valid <code className="px-1 rounded bg-red-100">.rpy</code> scripts, then retry.
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
                      onClick={() => appActions.reset()}
                     className="text-xs underline text-red-700 hover:text-red-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 rounded"
                   >
                      Start over
                    </button>
                    <button
                      type="button"
                      onClick={() => exportDebugBundle(debugPrivacyOptions)}
                      className="text-xs px-2.5 py-1.5 rounded-md border border-red-300 bg-white text-red-700 hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
                    >
                      Export Debug Bundle
                    </button>
                    <button
                      type="button"
                      onClick={() => openNewIssue(debugPrivacyOptions)}
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
                          setDebugPrivacyOptions((prev) => ({ ...prev, includeFileNames: event.target.checked }));
                        }}
                      />
                      Include file names (off by default because file names are sensitive)
                    </label>
                    <label className="flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        checked={debugPrivacyOptions.includeRawScriptDetails}
                        onChange={(event) => {
                          setDebugPrivacyOptions((prev) => ({ ...prev, includeRawScriptDetails: event.target.checked }));
                        }}
                      />
                      Include raw/script details (opt-in)
                    </label>
                    <label className="flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        checked={debugPrivacyOptions.includeExtraDiagnostics}
                        onChange={(event) => {
                          setDebugPrivacyOptions((prev) => ({ ...prev, includeExtraDiagnostics: event.target.checked }));
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
                     No labels or menus were found. Make sure the folder contains
                     valid Ren'Py <code className="text-xs bg-amber-100 px-1 rounded">.rpy</code> scripts.
                   </p>
                   <p className="text-xs text-amber-800">
                     Tip: try selecting the Ren'Py <code className="text-[11px] bg-amber-100 px-1 rounded">game/</code> folder directly.
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
                <div
                  key={title}
                  className="bg-white border border-gray-100 rounded-xl p-3"
                >
                  <p className="font-semibold text-gray-600 mb-1">{title}</p>
                  <p>{desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
