import { useAppStore, useDebugBundle } from "../application/index.ts";
import FlowchartViewer, {
  type FlowchartViewerProps,
} from "./FlowchartViewer.tsx";

export function FlowchartViewerContainer(props: Partial<FlowchartViewerProps>) {
  const storeNodes = useAppStore((s) => s.flowNodes);
  const storeEdges = useAppStore((s) => s.flowEdges);
  const storeDialogueSearchMode = useAppStore((s) => s.dialogueSearchMode);
  const storeSetDialogueSearchMode = useAppStore((s) =>
    s.setDialogueSearchMode
  );

  const debug = useDebugBundle();

  return (
    <FlowchartViewer
      flowNodes={props.flowNodes ?? storeNodes}
      flowEdges={props.flowEdges ?? storeEdges}
      dialogueSearchMode={props.dialogueSearchMode ?? storeDialogueSearchMode}
      onDialogueSearchModeChange={props.onDialogueSearchModeChange ??
        storeSetDialogueSearchMode}
      parseService={props.parseService}
      debugPrivacyOptions={props.debugPrivacyOptions ??
        debug.debugPrivacyOptions}
      onDebugPrivacyOptionsChange={props.onDebugPrivacyOptionsChange ??
        debug.setDebugPrivacyOptions}
      onExportDebugBundle={props.onExportDebugBundle ?? debug.exportDebugBundle}
      onOpenIssue={props.onOpenIssue ?? debug.openNewIssue}
    />
  );
}

export default FlowchartViewerContainer;
