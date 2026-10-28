import { getUploadedFilesCache, hasUploadedFilesCache } from "./uploadCache.ts";
import { useAppStore } from "./appStore.ts";
import { useViewerStore } from "./viewerStore.ts";
import { useParserRuleSettingsStore } from "./parserRuleSettingsStore.ts";
import { createProcessUpload } from "./processUpload.ts";
import {
  compileCustomVariant,
  serializeVariantPlugin,
} from "../config/parserRules.ts";
import {
  preWarmLayoutWorker,
  workerParseService,
} from "../infrastructure/index.ts";

import type { ParseService } from "./parseService.ts";

export interface ReparseOptions {
  preserveSession?: boolean;
  parseService?: ParseService;
}

/**
 * In-viewer live re-parse using cached UploadedFile handles.
 * Allows zero-re-upload instant flowchart updates when switching
 * variants or modifying screen action rules.
 */
export async function reparseUploadedFiles(
  options: ReparseOptions = {},
): Promise<boolean> {
  const store = useAppStore.getState();
  if (
    store.isReparsing ||
    store.phase === "reading" ||
    store.phase === "parsing"
  ) {
    return false;
  }

  const cached = getUploadedFilesCache();
  if (!cached || cached.length === 0) {
    return false;
  }

  const preserveSession = options.preserveSession ?? true;
  const ruleSettings = useParserRuleSettingsStore.getState();

  store.setIsReparsing(true);
  preWarmLayoutWorker();

  const activeRunIdRef = { current: 0 };
  const parseAbortControllerRef = { current: null as AbortController | null };

  const selectedVariant = ruleSettings.selectedVariant;
  const customRulesByVariant = ruleSettings.customRulesByVariant ?? {};
  const effectiveKey = selectedVariant === "auto"
    ? (store.parsedVariant ?? "renpy")
    : selectedVariant;
  const autoRules = Object.hasOwn(customRulesByVariant, "auto") &&
      Array.isArray(customRulesByVariant["auto"])
    ? customRulesByVariant["auto"]
    : [];
  const variantRules = Object.hasOwn(customRulesByVariant, effectiveKey) &&
      Array.isArray(customRulesByVariant[effectiveKey])
    ? customRulesByVariant[effectiveKey]
    : [];
  const selectedVariantCustomRules = [
    ...autoRules,
    ...variantRules,
  ];

  const parseService = options.parseService ?? workerParseService;

  const process = createProcessUpload({
    parseService,
    actions: {
      startReading: store.startReading,
      startParsing: store.startParsing,
      setIsReparsing: store.setIsReparsing,
      setProgress: store.setProgress,
      partialParseSuccess: store.partialParseSuccess,
      parseSuccess: store.parseSuccess,
      fail: store.fail,
    },
    activeRunIdRef,
    parseAbortControllerRef,
    dialogueSearchMode: store.dialogueSearchMode,
    parserVariant: selectedVariant,
    customRulesByVariant,
    customScreenActionRules: selectedVariantCustomRules,
    customVariantPlugins: ruleSettings.customVariants
      .map(compileCustomVariant)
      .map(serializeVariantPlugin),
    pruneDeadEndDecisions: ruleSettings.pruneDeadEndDecisions,
    preserveSession,
    onResetSession: () => useViewerStore.getState().resetSession(),
    onPostPreserveSession: (parsedNodes) => {
      const viewer = useViewerStore.getState();
      viewer.invalidateHydratedNodeDetails?.();
      if (
        viewer.selectedNodeId &&
        !parsedNodes.some((n) => n.id === viewer.selectedNodeId)
      ) {
        viewer.setSelectedNodeId("");
      }
    },
  });

  try {
    await process(cached, { preserveSession });
    return true;
  } catch (err) {
    console.error("In-viewer reparse failed:", err);
    return false;
  } finally {
    useAppStore.getState().setIsReparsing(false);
  }
}

export { hasUploadedFilesCache };
