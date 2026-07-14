/**
 * src/App.tsx
 *
 * Root application component.
 *
 * Provides a directory-upload interface that reads .rpy files via the
 * browser's FileReader API (no server round-trips), passes them to the
 * Ren'Py parser, and renders the resulting flowchart.
 */

import { useEffect, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  DiagnosticsSection,
  FlowchartViewer,
  Header,
  UploadArea,
} from "./ui/index.ts";
import {
  preWarmLayoutWorker,
} from "./infrastructure/index.ts";
import {
  useAppStore,
  useParserRuleSettingsStore,
  useViewerStore,
  useUploadOrchestrator,
  useDebugBundle,
} from "./application/index.ts";
import { cn } from "./ui/utils/cn.ts";
import { getParserVariantPlugins } from "./config/parserRules.ts";

export default function App() {
  // ── App state (Zustand store) ───────────────────────────────────────────────
  const {
    phase,
    flowNodes,
    flowEdges,
    parseDiagnostics,
    errorMsg,
    fileCount,
    parseProgress,
    importRevision,
    dialogueSearchMode,
  } = useAppStore(
    useShallow((s) => ({
      phase: s.phase,
      flowNodes: s.flowNodes,
      flowEdges: s.flowEdges,
      parseDiagnostics: s.parseDiagnostics,
      errorMsg: s.errorMsg,
      fileCount: s.fileCount,
      parseProgress: s.parseProgress,
      importRevision: s.importRevision,
      dialogueSearchMode: s.dialogueSearchMode,
    })),
  );
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

  // ── Parser settings (Zustand persist store) ─────────────────────────────────
  const {
    selectedVariant,
    customRulesByVariant,
    setSelectedVariant,
    addCustomRule,
    updateCustomRule,
    removeCustomRule,
    resetSettings: resetParserRuleSettings,
  } = useParserRuleSettingsStore(
    useShallow((s) => ({
      selectedVariant: s.selectedVariant,
      customRulesByVariant: s.customRulesByVariant,
      setSelectedVariant: s.setSelectedVariant,
      addCustomRule: s.addCustomRule,
      updateCustomRule: s.updateCustomRule,
      removeCustomRule: s.removeCustomRule,
      resetSettings: s.resetSettings,
    })),
  );
  const selectedVariantCustomRules = useMemo(
    () => customRulesByVariant[selectedVariant] ?? [],
    [customRulesByVariant, selectedVariant],
  );
  const parserVariantPlugins = useMemo(() => getParserVariantPlugins(), []);

  // Pre-warm the layout worker on boot
  useEffect(() => {
    preWarmLayoutWorker();
  }, []);

  // ── Hooks extracted ────────────────────────────────────────────────────────
  const {
    uploadedFiles,
    setUploadedFiles,
    processFiles,
    cancelParsing,
  } = useUploadOrchestrator();

  const {
    debugPrivacyOptions,
    setDebugPrivacyOptions,
    exportDebugBundle,
    openNewIssue,
  } = useDebugBundle();

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
            className="flex-1 flex flex-col overflow-hidden"
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
                onClick={() => {
                  setUploadedFiles([]);
                  appActions.reset();
                }}
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

            <FlowchartViewer
              key={importRevision}
              flowNodes={flowNodes}
              flowEdges={flowEdges}
              dialogueSearchMode={dialogueSearchMode}
              onDialogueSearchModeChange={(mode) =>
                appActions.setDialogueSearchMode(mode)}
              debugPrivacyOptions={debugPrivacyOptions}
              onDebugPrivacyOptionsChange={setDebugPrivacyOptions}
              onExportDebugBundle={exportDebugBundle}
              onOpenIssue={openNewIssue}
            />
          </main>
        )
        : (
          <UploadArea
            phase={phase}
            fileCount={fileCount}
            parseProgress={parseProgress}
            flowNodes={flowNodes}
            errorMsg={errorMsg}
            debugPrivacyOptions={debugPrivacyOptions}
            setDebugPrivacyOptions={setDebugPrivacyOptions}
            processFiles={processFiles}
            onCancelParsing={cancelParsing}
            onReset={() => {
              setUploadedFiles([]);
              appActions.reset();
            }}
            onExportDebugBundle={exportDebugBundle}
            onOpenIssue={openNewIssue}
            selectedVariant={selectedVariant}
            setSelectedVariant={setSelectedVariant}
            parserVariantPlugins={parserVariantPlugins}
            resetParserRuleSettings={resetParserRuleSettings}
            selectedVariantCustomRules={selectedVariantCustomRules}
            uploadedFiles={uploadedFiles}
            updateCustomRule={updateCustomRule}
            removeCustomRule={removeCustomRule}
            addCustomRule={addCustomRule}
          />
        )}
    </div>
  );
}
