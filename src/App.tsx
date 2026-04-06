/**
 * src/App.tsx
 *
 * Root application component.
 *
 * Provides a directory-upload interface that reads .rpy files via the
 * browser's FileReader API (no server round-trips), passes them to the
 * Ren'Py parser, and renders the resulting flowchart.
 */

import { useCallback, useMemo, useReducer, useRef } from 'react';
import { Upload, FolderOpen, AlertCircle, Loader2 } from 'lucide-react';
import { FlowchartViewer } from './ui';
import { createPerfTracker } from './perf';
import { appReducer, initialAppState, workerParseService, createProcessUpload } from './application';
import { MAX_RPY_FILE_COUNT, MAX_TOTAL_RPY_SIZE_BYTES } from './config/uploadLimits';

// ─── Component ────────────────────────────────────────────────────────────────

export default function App() {
  const perf = useMemo(() => createPerfTracker('app'), []);
  const [state, dispatch] = useReducer(appReducer, initialAppState);
  const parseAbortControllerRef = useRef<AbortController | null>(null);
  const activeRunIdRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // ── Process selected files ─────────────────────────────────────────────────
  const processFilesWithPerf = useCallback(
    async (files: FileList | null) => {
      perf.mark('read');
      const processFiles = createProcessUpload({
        parseService: workerParseService,
        dispatch,
        activeRunIdRef,
        parseAbortControllerRef,
        dialogueSearchMode: state.dialogueSearchMode,
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
    [dispatch, perf, state.dialogueSearchMode],
  );

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
    state.phase === 'idle'
      ? `Step 1 of 3 — Select a project folder with up to ${MAX_RPY_FILE_COUNT} .rpy files (${totalSizeMiB} MiB total).`
      : state.phase === 'reading'
        ? 'Step 2 of 3 — Reading selected files locally in your browser.'
        : state.phase === 'parsing'
          ? 'Step 3 of 3 — Parsing scripts and building graph nodes and edges.'
          : state.phase === 'error'
            ? 'Import failed. Review the guidance below, then choose a folder again.'
            : state.phase === 'done' && state.flowNodes.length === 0
              ? 'Import completed, but no labels or menus were found.'
              : state.phase === 'done'
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
      {state.phase === 'done' && state.flowNodes.length > 0 ? (
        /* ── Flowchart view ─────────────────────────────────────────────── */
        <main id="flowchart-main" className="flex-1 flex flex-col overflow-hidden" aria-label="Flowchart viewer">
          {/* Re-upload button */}
          <div className="shrink-0 bg-violet-50 border-b border-violet-100 px-4 py-2 flex flex-wrap items-center gap-2 sm:gap-3 text-sm text-violet-700">
            <span>
              Parsed <strong>{state.fileCount}</strong> .rpy file
              {state.fileCount !== 1 ? 's' : ''} →{' '}
              <strong>{state.flowNodes.length}</strong> nodes,{' '}
              <strong>{state.flowEdges.length}</strong> edges
            </span>
            <button
              onClick={() => {
                dispatch({ type: 'RESET' });
              }}
              className="sm:ml-auto text-xs underline text-violet-600 hover:text-violet-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 rounded"
            >
              Upload a different folder
            </button>
          </div>
          <FlowchartViewer
            key={state.importRevision}
            flowNodes={state.flowNodes}
            flowEdges={state.flowEdges}
            dialogueSearchMode={state.dialogueSearchMode}
            onDialogueSearchModeChange={(mode) => dispatch({ type: 'SET_DIALOGUE_SEARCH_MODE', mode })}
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
              aria-busy={state.phase === 'reading' || state.phase === 'parsing'}
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
               {state.phase === 'reading' || state.phase === 'parsing' ? (
                 <>
                   <Loader2 size={40} className="text-violet-500 animate-spin" aria-hidden="true" />
                   <p className="text-gray-600 font-medium">
                     {state.phase === 'reading'
                       ? `Reading ${state.fileCount} .rpy file${state.fileCount !== 1 ? 's' : ''}…`
                       : `Parsing ${state.parseProgress?.doneFiles ?? 0} / ${state.parseProgress?.totalFiles ?? state.fileCount} .rpy file${(state.parseProgress?.totalFiles ?? state.fileCount) !== 1 ? 's' : ''}…`}
                   </p>
                   {state.parseProgress?.currentFile && (
                     <p className="text-xs text-gray-500">Current: {state.parseProgress.currentFile}</p>
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

             {state.phase === 'parsing' && (
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
               {state.phase === 'error' && (
                <div className="mt-4 flex flex-col items-start gap-3 p-4 rounded-xl bg-red-50 border border-red-200 text-red-700">
                  <div className="flex flex-col sm:flex-row items-start gap-2">
                  <AlertCircle size={18} className="shrink-0 mt-0.5" aria-hidden="true" />
                  <div className="text-sm space-y-1">
                    <p>{state.errorMsg}</p>
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
                     onClick={() => dispatch({ type: 'RESET' })}
                     className="text-xs underline text-red-700 hover:text-red-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 rounded"
                   >
                     Start over
                   </button>
                 </div>
                </div>
              )}

             {/* Empty result warning */}
              {state.phase === 'done' && state.flowNodes.length === 0 && (
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
