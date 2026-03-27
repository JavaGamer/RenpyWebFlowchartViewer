/**
 * src/App.tsx
 *
 * Root application component.
 *
 * Provides a directory-upload interface that reads .rpy files via the
 * browser's FileReader API (no server round-trips), passes them to the
 * Ren'Py parser, and renders the resulting flowchart.
 */

import { useCallback, useState } from 'react';
import { Upload, FolderOpen, AlertCircle, Loader2 } from 'lucide-react';
import { parseRenpyFiles } from './parser';
import FlowchartViewer from './FlowchartViewer';
import type { FlowNode, FlowEdge } from './types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));
    reader.readAsText(file);
  });
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function App() {
  const [flowNodes, setFlowNodes] = useState<FlowNode[]>([]);
  const [flowEdges, setFlowEdges] = useState<FlowEdge[]>([]);
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [fileCount, setFileCount] = useState(0);

  // ── Process selected files ─────────────────────────────────────────────────
  const processFiles = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;

    const rpyFiles: File[] = [];
    for (const file of files) {
      if (file.name.endsWith('.rpy')) rpyFiles.push(file);
    }

    if (rpyFiles.length === 0) {
      setErrorMsg('No .rpy files found in the selected directory.');
      setStatus('error');
      return;
    }

    setStatus('loading');
    setFileCount(rpyFiles.length);
    setErrorMsg('');

    try {
      const inputs = await Promise.all(
        rpyFiles.map(async (f) => ({
          name: f.name,
          content: await readFileAsText(f),
        })),
      );

      const { nodes, edges } = await parseRenpyFiles(inputs);

      setFlowNodes(nodes);
      setFlowEdges(edges);
      setStatus('done');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(msg);
      setStatus('error');
    }
  }, []);

  // ── Drag-and-drop support ──────────────────────────────────────────────────
  const onDrop = useCallback(
    (e: React.DragEvent<HTMLLabelElement>) => {
      e.preventDefault();
      void processFiles(e.dataTransfer.files);
    },
    [processFiles],
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
      {status === 'done' && flowNodes.length > 0 ? (
        /* ── Flowchart view ─────────────────────────────────────────────── */
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Re-upload button */}
          <div className="shrink-0 bg-violet-50 border-b border-violet-100 px-4 py-2 flex items-center gap-3 text-sm text-violet-700">
            <span>
              Parsed <strong>{fileCount}</strong> .rpy file
              {fileCount !== 1 ? 's' : ''} &rarr;{' '}
              <strong>{flowNodes.length}</strong> nodes,{' '}
              <strong>{flowEdges.length}</strong> edges
            </span>
            <button
              onClick={() => {
                setStatus('idle');
                setFlowNodes([]);
                setFlowEdges([]);
              }}
              className="ml-auto text-xs underline text-violet-600 hover:text-violet-800"
            >
              Upload a different folder
            </button>
          </div>
          <FlowchartViewer flowNodes={flowNodes} flowEdges={flowEdges} />
        </div>
      ) : (
        /* ── Upload area ─────────────────────────────────────────────────── */
        <div className="flex-1 flex flex-col items-center justify-center p-8">
          <div className="w-full max-w-xl">
            {/* Drop zone */}
            <label
              htmlFor="folder-input"
              onDrop={onDrop}
              onDragOver={onDragOver}
              className="flex flex-col items-center justify-center gap-4 w-full h-64 rounded-2xl border-2 border-dashed border-violet-300 bg-white hover:bg-violet-50 hover:border-violet-400 transition-colors cursor-pointer"
            >
              {status === 'loading' ? (
                <>
                  <Loader2 size={40} className="text-violet-500 animate-spin" />
                  <p className="text-gray-600 font-medium">
                    Parsing {fileCount} .rpy file{fileCount !== 1 ? 's' : ''}&#8230;
                  </p>
                </>
              ) : (
                <>
                  <Upload size={40} className="text-violet-400" />
                  <div className="text-center">
                    <p className="text-base font-semibold text-gray-700">
                      Drop your Ren&#x2019;Py project folder here
                    </p>
                    <p className="text-sm text-gray-400 mt-1">
                      or click to browse and select the folder
                    </p>
                  </div>
                  <span className="text-xs text-gray-400 bg-gray-100 px-3 py-1 rounded-full">
                    All processing is local &#8212; your files never leave your device
                  </span>
                </>
              )}
            </label>

            {/* Hidden file input with directory support */}
            <input
              id="folder-input"
              type="file"
              className="hidden"
              // @ts-expect-error — non-standard but widely supported attributes
              webkitdirectory=""
              directory=""
              multiple
              onChange={(e) => void processFiles(e.target.files)}
            />

            {/* Error message */}
            {status === 'error' && (
              <div className="mt-4 flex items-start gap-2 p-4 rounded-xl bg-red-50 border border-red-200 text-red-700">
                <AlertCircle size={18} className="shrink-0 mt-0.5" />
                <p className="text-sm">{errorMsg}</p>
              </div>
            )}

            {/* Empty result warning */}
            {status === 'done' && flowNodes.length === 0 && (
              <div className="mt-4 flex items-start gap-2 p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-700">
                <AlertCircle size={18} className="shrink-0 mt-0.5" />
                <p className="text-sm">
                  No labels or menus were found. Make sure the folder contains
                  valid Ren&#x2019;Py <code className="text-xs bg-amber-100 px-1 rounded">.rpy</code> scripts.
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
