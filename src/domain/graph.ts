export type NodeType = 'LABEL' | 'MENU';
export type NodeRole = 'story' | 'detour' | 'utility' | 'state_toggle' | 'menu';
export type EdgeKind = 'sequence' | 'jump' | 'call' | 'call_return';

/** A node in the flowchart graph. */
export interface FlowNode {
  id: string;
  /** 'LABEL' for `label name:` blocks; 'MENU' for `menu:` blocks. */
  type: NodeType;
  /** Strict role classification for LABEL nodes, or 'menu' for MENU nodes. */
  role?: NodeRole;
  /** Human-readable name shown in the chart. */
  label: string;
  /** Number of dialogue lines inside this block. */
  dialogueCount: number;
  /** Dialogue line text captured from say statements in this block. */
  dialogueLines?: string[];
  /** Source chapter inferred from the .rpy filename. */
  chapter?: string;
  /** Parent label id for MENU nodes. */
  parentLabelId?: string;
}

/** A directed edge in the flowchart graph. */
export interface FlowEdge {
  id: string;
  source: string;
  target: string;
  /** Edge semantics used by viewer toggles/export. */
  kind?: EdgeKind;
  /** Optional label shown on the edge (e.g. menu option text). */
  label?: string;
}
