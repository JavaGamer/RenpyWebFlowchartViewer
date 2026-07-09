import type { KeyboardEvent as ReactKeyboardEvent } from "react";

export interface CanvasMetrics {
  visibleNodeCount: number;
  visibleEdgeCount: number;
  dialogueLineSearchEnabled: boolean;
  isLargeExportTarget: boolean;
  /** Total word count across all parsed nodes (not affected by filters). */
  totalWordCount: number;
  /** Total pause duration across all parsed nodes (not affected by filters). */
  totalPauseDuration: number;
  /** Word count across currently visible (non-hidden, non-filtered) nodes. */
  visibleWordCount: number;
  /** Pause duration across currently visible nodes. */
  visiblePauseDuration: number;
}

export interface CanvasCallbacksRegistry {
  onSearchInputKeyDown: (e: ReactKeyboardEvent<HTMLInputElement>) => void;
}
