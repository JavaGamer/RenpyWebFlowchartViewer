import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

export interface CanvasMetrics {
  visibleNodeCount: number;
  visibleEdgeCount: number;
  dialogueLineSearchEnabled: boolean;
  isLargeExportTarget: boolean;
}

export interface CanvasCallbacksRegistry {
  onSearchInputKeyDown: (e: ReactKeyboardEvent<HTMLInputElement>) => void;
}
