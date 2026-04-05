import type { FlowEdge, FlowNode, AppPhase } from '../domain/graph';

export type ParseProgress = {
  doneFiles: number;
  totalFiles: number;
  currentFile: string;
};

export interface AppState {
  phase: AppPhase;
  flowNodes: FlowNode[];
  flowEdges: FlowEdge[];
  errorMsg: string;
  fileCount: number;
  parseProgress: ParseProgress | null;
}

export type AppAction =
  | { type: 'RESET' }
  | { type: 'START_READING'; fileCount: number }
  | { type: 'START_PARSING' }
  | { type: 'PROGRESS'; progress: ParseProgress }
  | { type: 'PARSE_SUCCESS'; nodes: FlowNode[]; edges: FlowEdge[] }
  | { type: 'FAIL'; message: string };

export const initialAppState: AppState = {
  phase: 'idle',
  flowNodes: [],
  flowEdges: [],
  errorMsg: '',
  fileCount: 0,
  parseProgress: null,
};

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'RESET':
      return initialAppState;
    case 'START_READING':
      return {
        ...state,
        phase: 'reading',
        fileCount: action.fileCount,
        errorMsg: '',
        parseProgress: { doneFiles: 0, totalFiles: action.fileCount, currentFile: '' },
      };
    case 'START_PARSING':
      return { ...state, phase: 'parsing' };
    case 'PROGRESS':
      return { ...state, parseProgress: action.progress };
    case 'PARSE_SUCCESS':
      return {
        ...state,
        phase: 'done',
        flowNodes: action.nodes,
        flowEdges: action.edges,
        parseProgress: null,
      };
    case 'FAIL':
      return { ...state, phase: 'error', errorMsg: action.message, parseProgress: null };
    default:
      return state;
  }
}
