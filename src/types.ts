/** A node in the flowchart graph. */
export interface FlowNode {
  id: string;
  /** 'LABEL' for `label name:` blocks; 'MENU' for `menu:` blocks. */
  type: 'LABEL' | 'MENU';
  /** Strict role classification for LABEL nodes, or 'menu' for MENU nodes. */
  role?: 'story' | 'detour' | 'utility' | 'state_toggle' | 'menu';
  /** Human-readable name shown in the chart. */
  label: string;
  /** Number of dialogue lines inside this block. */
  dialogueCount: number;
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
  kind?: 'sequence' | 'jump' | 'call' | 'call_return';
  /** Optional label shown on the edge (e.g. menu option text). */
  label?: string;
}
