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
import FlowchartViewer from './FlowchartViewer';
import { createPerfTracker } from './perf';
import { appReducer, initialAppState } from './application/appState';
import { workerParseService } from './application/parseService';
import { createProcessUpload } from './application/processUpload';

// ─── Component ────────────────────────────────────────────────────────────────

export default function App() {
  const perf = useMemo(() => createPerfTracker('app'), []);
  const [state, dispatch] = useReducer(appReducer, initialAppState);
  const parseAbortControllerRef = useRef<AbortController | null>(null);
  const activeRunIdRef = useRef(0);

  // ── Process selected files ─────────────────────────────────────────────────
  const processFilesWithPerf = useCallback(
    async (files: FileList | null) => {
      perf.mark('read');
      perf.mark('parse');
      const processFiles = createProcessUpload({
        parseService: workerParseService,
        dispatch,
        activeRunIdRef,
        parseAbortControllerRef,
        onReadMeasured: (fileCount) => {
          perf.measure('read', 'read_files_ms', { files: fileCount });
        },
        onParseMeasured: ({ fileCount, nodeCount, edgeCount }) => {
          perf.measure('parse', 'parse_ms', { files: fileCount, nodes: nodeCount, edges: edgeCount });
        },
      });
      await processFiles(files);
    },
    [perf],
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

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full min-h-screen bg-gray-50 font-sans">
      {/* Header */}
      <header className="shrink-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center gap-3 shadow-sm">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-violet-600 rounded-lg flex items-center justify-center">
            <FolderOpen size={16} className="text-white" />
          </div>
          <h1 className="text-lg font-bold text-gray-900 tracking-tight">
            Ren'Py Flowchart Viewer
          </h1>
        </div>
        <span className="ml-2 text-xs text-gray-400 hidden sm:block">
          Upload a Ren'Py project folder to visualize its script structure
        </span>
      </header>

      {/* Main content */}
      {state.phase === 'done' && state.flowNodes.length > 0 ? (
        /* ── Flowchart view ─────────────────────────────────────────────── */
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Re-upload button */}
          <div className="shrink-0 bg-violet-50 border-b border-violet-100 px-4 py-2 flex items-center gap-3 text-sm text-violet-700">
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
              className="ml-auto text-xs underline text-violet-600 hover:text-violet-800"
            >
              Upload a different folder
            </button>
          </div>
          <FlowchartViewer flowNodes={state.flowNodes} flowEdges={state.flowEdges} />
        </div>
      ) : (
        /* ── Upload area ─────────────────────────────────────────────────── */
        <div className="flex-1 flex flex-col items-center justify-center p-8">
          <div className="w-full max-w-xl">
            {/* Drop zone */}
            <label
              htmlFor="folder-input"
              aria-label="Upload Ren'Py project folder"
              onDrop={onDrop}
              onDragOver={onDragOver}
              className="flex flex-col items-center justify-center gap-4 w-full h-64 rounded-2xl border-2 border-dashed border-violet-300 bg-white hover:bg-violet-50 hover:border-violet-400 transition-colors cursor-pointer"
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
                      or click to browse and select the folder
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
                  className="text-xs underline text-gray-600 hover:text-gray-800"
                  aria-label="Cancel parsing"
                >
                  Cancel parsing
                </button>
              </div>
            )}

            {/* Error message */}
             {state.phase === 'error' && (
              <div className="mt-4 flex items-start gap-2 p-4 rounded-xl bg-red-50 border border-red-200 text-red-700">
                <AlertCircle size={18} className="shrink-0 mt-0.5" aria-hidden="true" />
                 <p className="text-sm">{state.errorMsg}</p>
              </div>
            )}

            {/* Empty result warning */}
             {state.phase === 'done' && state.flowNodes.length === 0 && (
              <div className="mt-4 flex items-start gap-2 p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-700">
                <AlertCircle size={18} className="shrink-0 mt-0.5" aria-hidden="true" />
                <p className="text-sm">
                  No labels or menus were found. Make sure the folder contains
                  valid Ren'Py <code className="text-xs bg-amber-100 px-1 rounded">.rpy</code> scripts.
                </p>
              </div>
            )}

            {/* Feature hints */}
            <div className="mt-8 grid grid-cols-2 gap-3 text-center text-xs text-gray-400">
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
