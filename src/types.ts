/** A node in the flowchart graph. */
export interface FlowNode {
  id: string;
  /** 'LABEL' for `label name:` blocks; 'MENU' for `menu:` blocks. */
  type: 'LABEL' | 'MENU';
  /** Human-readable name shown in the chart. */
  label: string;
  /** Number of dialogue lines inside this block. */
  dialogueCount: number;
}

/** A directed edge in the flowchart graph. */
export interface FlowEdge {
  id: string;
  source: string;
  target: string;
  /** Optional label shown on the edge (e.g. menu option text). */
  label?: string;
}
