import { useCallback, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { useAppStore } from "./appStore.ts";
import { useParserRuleSettingsStore } from "./parserRuleSettingsStore.ts";
import { useViewerStore } from "./viewerStore.ts";
import { buildDebugBundle, toDebugBundleBlob, buildIssueDraftUrl, type DebugBundlePrivacyOptions } from "./debugBundle.ts";

export interface UseDebugBundleResult {
  debugPrivacyOptions: DebugBundlePrivacyOptions;
  setDebugPrivacyOptions: (value: React.SetStateAction<DebugBundlePrivacyOptions>) => void;
  exportDebugBundle: (privacy: DebugBundlePrivacyOptions) => Promise<void>;
  openNewIssue: (privacy: DebugBundlePrivacyOptions) => void;
}

export function useDebugBundle(): UseDebugBundleResult {
  const {
    phase,
    fileCount,
    importRevision,
    dialogueSearchMode,
    errorMsg,
    parseProgress,
    flowNodes,
    flowEdges,
    parseDiagnostics,
  } = useAppStore(
    useShallow((s) => ({
      phase: s.phase,
      fileCount: s.fileCount,
      importRevision: s.importRevision,
      dialogueSearchMode: s.dialogueSearchMode,
      errorMsg: s.errorMsg,
      parseProgress: s.parseProgress,
      flowNodes: s.flowNodes,
      flowEdges: s.flowEdges,
      parseDiagnostics: s.parseDiagnostics,
    })),
  );

  const { selectedVariant, customRulesByVariant } = useParserRuleSettingsStore(
    useShallow((s) => ({
      selectedVariant: s.selectedVariant,
      customRulesByVariant: s.customRulesByVariant,
    })),
  );

  const selectedVariantCustomRules = useMemo(
    () => customRulesByVariant[selectedVariant] ?? [],
    [customRulesByVariant, selectedVariant],
  );

  const debugPrivacyOptions = useViewerStore((s) => s.debugPrivacyOptions);
  const updateDebugPrivacyOptions = useViewerStore((s) => s.updateDebugPrivacyOptions);

  const setDebugPrivacyOptions = useCallback(
    (value: React.SetStateAction<DebugBundlePrivacyOptions>) => {
      if (typeof value === "function") {
        updateDebugPrivacyOptions(
          value(useViewerStore.getState().debugPrivacyOptions),
        );
      } else {
        updateDebugPrivacyOptions(value);
      }
    },
    [updateDebugPrivacyOptions],
  );

  const appVersion = import.meta.env.VITE_APP_VERSION ?? "0.0.0";

  const exportDebugBundle = useCallback(
    async (privacy: DebugBundlePrivacyOptions) => {
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
      const { saveAs } = await import("file-saver");
      saveAs(toDebugBundleBlob(bundle), "renpy-flowchart-debug-bundle.json");
    },
    [
      appVersion,
      phase,
      fileCount,
      importRevision,
      dialogueSearchMode,
      errorMsg,
      parseProgress,
      flowNodes,
      flowEdges,
      parseDiagnostics,
      selectedVariant,
      selectedVariantCustomRules,
    ],
  );

  const openNewIssue = useCallback(
    (privacy: DebugBundlePrivacyOptions) => {
      const issueUrl = buildIssueDraftUrl({
        owner: "JavaGamer",
        repo: "RenpyWebFlowchartViewer",
        privacy,
        state: {
          phase,
          dialogueSearchMode,
          selectedVariant,
          fileCount,
          warningCount: parseDiagnostics.length,
        },
      });
      if (typeof globalThis.open !== "function") return;
      globalThis.open(issueUrl, "_blank", "noopener,noreferrer");
    },
    [
      selectedVariant,
      dialogueSearchMode,
      fileCount,
      parseDiagnostics.length,
      phase,
    ],
  );

  return {
    debugPrivacyOptions,
    setDebugPrivacyOptions,
    exportDebugBundle,
    openNewIssue,
  };
}
