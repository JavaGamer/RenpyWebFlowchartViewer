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
import { saveAs } from 'file-saver';
import { Header, DiagnosticsSection, UploadArea, FlowchartViewer } from './ui';
import { createPerfTracker } from './infrastructure';
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
  useTelemetryStore,
} from './application';
import {
  getParserVariantPlugins,
} from './config/parserRules';

export default function App() {
  const perf = useMemo(() => createPerfTracker('app', {
    onEvent: (event) => {
      const store = useTelemetryStore.getState();
      if (event.metric === 'read_files_ms') {
        store.recordRead(event.ms);
        if (typeof event.detail?.files === 'number') {
          store.setFileCount(event.detail.files);
        }
      } else if (event.metric === 'parse_ms') {
        store.recordParse(event.ms, event.detail as any);
        if (typeof event.detail?.nodes === 'number') {
          store.setGraphMetrics(
            event.detail.nodes as number,
            (event.detail.edges as number) ?? 0,
          );
        }
      } else if (event.metric === 'layout_ms') {
        store.recordLayout(event.ms);
      } else if (event.metric === 'render_commit_ms') {
        store.recordRender(event.ms);
      }
    },
  }), []);

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
  const selectedVariant = useParserRuleSettingsStore((s) => s.selectedVariant);
  const customRulesByVariant = useParserRuleSettingsStore((s) => s.customRulesByVariant);
  const setSelectedVariant = useParserRuleSettingsStore((s) => s.setSelectedVariant);
  const addCustomRule = useParserRuleSettingsStore((s) => s.addCustomRule);
  const updateCustomRule = useParserRuleSettingsStore((s) => s.updateCustomRule);
  const removeCustomRule = useParserRuleSettingsStore((s) => s.removeCustomRule);
  const resetParserRuleSettings = useParserRuleSettingsStore((s) => s.resetSettings);
  const selectedVariantCustomRules = useMemo(
    () => customRulesByVariant[selectedVariant] ?? [],
    [customRulesByVariant, selectedVariant],
  );
  const parserVariantPlugins = useMemo(() => getParserVariantPlugins(), []);

  const [debugPrivacyOptions, setDebugPrivacyOptions] = useState<DebugBundlePrivacyOptions>(
    DEFAULT_DEBUG_BUNDLE_PRIVACY_OPTIONS,
  );
  const parseAbortControllerRef = useRef<AbortController | null>(null);
  const activeRunIdRef = useRef(0);

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
          perf.measure('parse', 'parse_ms', {
            files: fileCount,
            nodes: nodeCount,
            edges: edgeCount,
          });
        },
      });
      await processFiles(files);
    },
    [appActions, perf, selectedVariant, selectedVariantCustomRules, dialogueSearchMode],
  );

  const appVersion = import.meta.env.VITE_APP_VERSION ?? '0.0.0';
  const exportDebugBundle = useCallback(
    (privacy: DebugBundlePrivacyOptions) => {
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
        parseDiagnostics,
        privacy,
      });
      saveAs(toDebugBundleBlob(bundle), 'renpy-flowchart-debug-bundle.json');
    },
    [
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
      parseDiagnostics,
      phase,
    ],
  );
  const openNewIssue = useCallback(
    (privacy: DebugBundlePrivacyOptions) => {
      const issueUrl = buildIssueDraftUrl({
        owner: 'JavaGamer',
        repo: 'RenpyWebFlowchartViewer',
        privacy,
        state: {
          phase,
          dialogueSearchMode,
          selectedVariant,
          fileCount,
          warningCount: parseDiagnostics.length,
        },
      });
      if (typeof globalThis.open !== 'function') return;
      globalThis.open(issueUrl, '_blank', 'noopener,noreferrer');
    },
    [selectedVariant, dialogueSearchMode, fileCount, parseDiagnostics.length, phase],
  );

  return (
    <div className="flex flex-col h-full min-h-screen bg-gray-50 font-sans">
      <a
        href="#flowchart-main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:text-violet-700 focus:shadow"
      >
        Skip to flowchart
      </a>

      <Header />

      {phase === 'done' && flowNodes.length > 0 ? (
        <main
          id="flowchart-main"
          className="flex-1 flex flex-col overflow-hidden"
          aria-label="Flowchart viewer"
        >
          {/* Re-upload button */}
          <div className="shrink-0 bg-violet-50 border-b border-violet-100 px-4 py-2 flex flex-wrap items-center gap-2 sm:gap-3 text-sm text-violet-700">
            <span>
              Parsed <strong>{fileCount}</strong> .rpy file
              {fileCount !== 1 ? 's' : ''} → <strong>{flowNodes.length}</strong> nodes,{' '}
              <strong>{flowEdges.length}</strong> edges
            </span>
            {parseDiagnostics.length > 0 && (
              <span className="text-xs font-semibold rounded-full bg-amber-100 text-amber-800 px-2 py-0.5">
                {parseDiagnostics.length} parse warning{parseDiagnostics.length === 1 ? '' : 's'}
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

          <DiagnosticsSection parseDiagnostics={parseDiagnostics} />

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
        <UploadArea
          phase={phase}
          fileCount={fileCount}
          parseProgress={parseProgress}
          flowNodes={flowNodes}
          errorMsg={errorMsg}
          debugPrivacyOptions={debugPrivacyOptions}
          setDebugPrivacyOptions={setDebugPrivacyOptions}
          processFiles={processFilesWithPerf}
          onCancelParsing={() => parseAbortControllerRef.current?.abort()}
          onReset={() => appActions.reset()}
          onExportDebugBundle={exportDebugBundle}
          onOpenIssue={openNewIssue}
          selectedVariant={selectedVariant}
          setSelectedVariant={setSelectedVariant}
          parserVariantPlugins={parserVariantPlugins}
          resetParserRuleSettings={resetParserRuleSettings}
          selectedVariantCustomRules={selectedVariantCustomRules}
          updateCustomRule={updateCustomRule}
          removeCustomRule={removeCustomRule}
          addCustomRule={addCustomRule}
        />
      )}
    </div>
  );
}
