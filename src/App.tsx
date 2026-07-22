/**
 * src/App.tsx
 *
 * Root application component.
 *
 * Provides a directory-upload interface that reads .rpy files via the
 * browser's FileReader API (no server round-trips), passes them to the
 * Ren'Py parser, and renders the resulting flowchart.
 */

import { useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  DiagnosticsSection,
  FlowchartViewer,
  Header,
  UploadArea,
} from "./ui/index.ts";
import {
  getProjectFromCache,
  getRecentProjects,
  preWarmLayoutWorker,
} from "./infrastructure/index.ts";
import { useAppStore, useViewerStore } from "./application/index.ts";
import { cn } from "./ui/utils/cn.ts";

export default function App() {
  // ── App state (Zustand store) ───────────────────────────────────────────────
  const {
    phase,
    flowNodes,
    flowEdges,
    parseDiagnostics,
    fileCount,
    importRevision,
  } = useAppStore(
    useShallow((s) => ({
      phase: s.phase,
      flowNodes: s.flowNodes,
      flowEdges: s.flowEdges,
      parseDiagnostics: s.parseDiagnostics,
      fileCount: s.fileCount,
      importRevision: s.importRevision,
    })),
  );
  const reset = useAppStore((s) => s.reset);
  const parseSuccess = useAppStore((s) => s.parseSuccess);
  const startParsing = useAppStore((s) => s.startParsing);

  const [isRestoring, setIsRestoring] = useState(true);

  // Pre-warm the layout worker on boot and restore last project
  useEffect(() => {
    preWarmLayoutWorker();

    // Auto-restore last accessed project
    getRecentProjects().then(async (projects) => {
      if (projects.length > 0) {
        const lastProject = projects[0];
        if (lastProject) {
          startParsing();
          const fullProject = await getProjectFromCache(lastProject.id);
          if (fullProject) {
            parseSuccess(
              fullProject.nodes,
              fullProject.edges,
              fullProject.diagnostics,
            );
          } else {
            reset();
          }
        }
      }
      setIsRestoring(false);
    }).catch(() => {
      setIsRestoring(false);
    });
  }, [startParsing, parseSuccess, reset]);

  const theme = useViewerStore((s) => s.theme);
  const isDark = theme === "dark";

  return (
    <div
      className={cn(
        "flex flex-col h-full min-h-screen font-sans transition-colors duration-200",
        isDark ? "bg-slate-950 text-slate-100" : "bg-gray-50 text-gray-900",
      )}
      data-theme={theme}
    >
      <a
        href="#flowchart-main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:text-violet-700 focus:shadow"
      >
        Skip to flowchart
      </a>

      <Header />

      {phase === "done" && flowNodes.length > 0
        ? (
          <main
            id="flowchart-main"
            tabIndex={-1}
            className="flex-1 flex flex-col overflow-hidden focus:outline-none"
            aria-label="Flowchart viewer"
          >
            {/* Re-upload button */}
            <div
              className={cn(
                "shrink-0 px-4 py-2 flex flex-wrap items-center gap-2 sm:gap-3 text-sm border-b transition-colors duration-200",
                isDark
                  ? "bg-violet-950/20 border-violet-900/30 text-violet-300"
                  : "bg-violet-50 border-violet-100 text-violet-700",
              )}
            >
              <span>
                Parsed <strong>{fileCount}</strong> .rpy file
                {fileCount !== 1 ? "s" : ""} →{" "}
                <strong>{flowNodes.length}</strong> nodes,{" "}
                <strong>{flowEdges.length}</strong> edges
              </span>
              {parseDiagnostics.length > 0 && (
                <span className="text-xs font-semibold rounded-full bg-amber-100 text-amber-800 px-2 py-0.5">
                  {parseDiagnostics.length}{" "}
                  parse warning{parseDiagnostics.length === 1 ? "" : "s"}
                </span>
              )}
              <button
                onClick={reset}
                className={cn(
                  "sm:ml-auto text-xs underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 rounded",
                  isDark
                    ? "text-violet-400 hover:text-violet-300"
                    : "text-violet-600 hover:text-violet-800",
                )}
              >
                Upload a different folder
              </button>
            </div>

            <DiagnosticsSection parseDiagnostics={parseDiagnostics} />

            <FlowchartViewer key={importRevision} />
          </main>
        )
        : (
          <div className="flex-1 flex flex-col relative">
            {isRestoring && (
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/50 dark:bg-slate-950/50 backdrop-blur-sm">
                <div className="flex flex-col items-center gap-2">
                  <div className="w-6 h-6 border-2 border-violet-500 border-t-transparent rounded-full animate-spin">
                  </div>
                  <span className="text-sm text-slate-500 dark:text-slate-400">
                    Restoring project...
                  </span>
                </div>
              </div>
            )}
            <UploadArea />
          </div>
        )}
    </div>
  );
}
