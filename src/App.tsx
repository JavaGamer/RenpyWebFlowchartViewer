/**
 * src/App.tsx
 *
 * Root application component.
 *
 * Provides a directory-upload interface that reads .rpy files via the
 * browser's FileReader API (no server round-trips), passes them to the
 * Ren'Py parser, and renders the resulting flowchart.
 */

import { useEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import { Loader2 } from "lucide-react";
import {
  DiagnosticsSection,
  FlowchartViewerContainer,
  Header,
  UploadAreaContainer,
} from "./ui/index.ts";
import { preWarmLayoutWorker } from "./infrastructure/index.ts";
import { useAppStore, useViewerStore } from "./application/index.ts";
import { THEMES } from "./ui/viewerTheme.ts";
import { cn } from "./ui/utils/cn.ts";

export default function App() {
  // ── App state (Zustand store) ───────────────────────────────────────────────
  const {
    phase,
    flowNodes,
    parseDiagnostics,
    importRevision,
    isReparsing,
  } = useAppStore(
    useShallow((s) => ({
      phase: s.phase,
      flowNodes: s.flowNodes,
      parseDiagnostics: s.parseDiagnostics,
      importRevision: s.importRevision,
      isReparsing: s.isReparsing,
    })),
  );

  // Pre-warm the layout worker on boot
  useEffect(() => {
    preWarmLayoutWorker();
  }, []);

  const theme = useViewerStore((s) => s.theme);
  const isDark = theme === "dark";

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.classList.toggle("dark", isDark);
    document.documentElement.style.colorScheme = isDark ? "dark" : "light";
    document.body.style.backgroundColor = THEMES[theme]?.pageBg ??
      (isDark ? "#020617" : "#f9fafb");
    document.body.style.color = THEMES[theme]?.text ??
      (isDark ? "#f8fafc" : "#111827");
  }, [theme, isDark]);

  return (
    <div
      className={cn(
        "flex flex-col font-sans transition-colors duration-200",
        phase === "done" ? "h-screen overflow-hidden" : "min-h-screen",
        isDark ? "bg-slate-950 text-slate-100" : "bg-gray-50 text-gray-900",
      )}
      style={{
        backgroundColor: THEMES[theme]?.pageBg,
        color: THEMES[theme]?.text,
      }}
      data-theme={theme}
    >
      <a
        href="#flowchart-main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:text-violet-700 focus:shadow"
      >
        Skip to flowchart
      </a>

      {(phase !== "done" || flowNodes.length === 0) && <Header />}

      {isReparsing && (
        <div
          data-testid="reparsing-indicator"
          className="fixed top-14 right-6 z-50 flex items-center gap-2 px-3 py-1.5 rounded-full bg-violet-600 text-white text-xs font-semibold shadow-lg backdrop-blur-sm animate-pulse"
        >
          <Loader2 size={13} className="animate-spin" />
          <span>Re-parsing flowchart...</span>
        </div>
      )}

      {phase === "done" && flowNodes.length > 0
        ? (
          <main
            id="flowchart-main"
            className="flex-1 flex flex-col overflow-hidden"
            aria-label="Flowchart viewer"
          >
            {parseDiagnostics.length > 0 && (
              <DiagnosticsSection parseDiagnostics={parseDiagnostics} />
            )}
            <FlowchartViewerContainer key={importRevision} />
          </main>
        )
        : (
          <main
            id="flowchart-main"
            className="flex-1 flex flex-col"
            aria-label="Upload scripts"
          >
            <UploadAreaContainer />
          </main>
        )}
    </div>
  );
}
