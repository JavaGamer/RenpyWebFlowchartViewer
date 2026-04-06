import type { FlowEdge, FlowNode } from '../domain';
import type { DialogueSearchMode, ParseService } from '../application';

export interface FlowchartViewerProps {
  flowNodes: FlowNode[];
  flowEdges: FlowEdge[];
  dialogueSearchMode?: DialogueSearchMode;
  onDialogueSearchModeChange?: (mode: DialogueSearchMode) => void;
  parseService?: ParseService;
}
