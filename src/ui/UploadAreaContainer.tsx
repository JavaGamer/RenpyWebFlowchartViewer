import { useShallow } from "zustand/react/shallow";
import {
  useAppStore,
  useDebugBundle,
  useParserRuleSettingsStore,
  useUploadOrchestrator,
} from "../application/index.ts";
import { getParserVariantPlugins } from "../config/parserRules.ts";
import UploadArea, { type UploadAreaProps } from "./UploadArea.tsx";

export function UploadAreaContainer(props: Partial<UploadAreaProps>) {
  // App store
  const {
    phase,
    fileCount,
    parseProgress,
    flowNodes,
    errorMsg,
    reset,
  } = useAppStore(
    useShallow((s) => ({
      phase: s.phase,
      fileCount: s.fileCount,
      parseProgress: s.parseProgress,
      flowNodes: s.flowNodes,
      errorMsg: s.errorMsg,
      reset: s.reset,
    })),
  );

  // Upload orchestrator hook
  const orchestrator = useUploadOrchestrator();

  // Debug bundle hook
  const debug = useDebugBundle();

  // Parser settings store
  const settings = useParserRuleSettingsStore();
  const selectedVariant = props.selectedVariant ?? settings.selectedVariant;
  const customRules = settings.customRulesByVariant[selectedVariant] ?? [];

  return (
    <UploadArea
      phase={props.phase ?? phase}
      fileCount={props.fileCount ?? fileCount}
      parseProgress={props.parseProgress ?? parseProgress}
      flowNodes={props.flowNodes ?? flowNodes}
      errorMsg={props.errorMsg ?? errorMsg}
      onReset={props.onReset ?? reset}
      uploadedFiles={props.uploadedFiles ?? orchestrator.uploadedFiles}
      processFiles={props.processFiles ?? orchestrator.processFiles}
      onCancelParsing={props.onCancelParsing ?? orchestrator.cancelParsing}
      debugPrivacyOptions={props.debugPrivacyOptions ??
        debug.debugPrivacyOptions}
      setDebugPrivacyOptions={props.setDebugPrivacyOptions ??
        debug.setDebugPrivacyOptions}
      onExportDebugBundle={props.onExportDebugBundle ?? debug.exportDebugBundle}
      onOpenIssue={props.onOpenIssue ?? debug.openNewIssue}
      selectedVariant={selectedVariant}
      setSelectedVariant={props.setSelectedVariant ??
        settings.setSelectedVariant}
      parserVariantPlugins={props.parserVariantPlugins ??
        getParserVariantPlugins()}
      resetParserRuleSettings={props.resetParserRuleSettings ??
        settings.resetSettings}
      selectedVariantCustomRules={props.selectedVariantCustomRules ??
        customRules}
      updateCustomRule={props.updateCustomRule ?? settings.updateCustomRule}
      removeCustomRule={props.removeCustomRule ?? settings.removeCustomRule}
      addCustomRule={props.addCustomRule ?? settings.addCustomRule}
    />
  );
}

export default UploadAreaContainer;
