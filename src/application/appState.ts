import type { FlowEdge, FlowNode } from '../domain';
import type { AppPhase } from './appTypes';

export type ParseProgress = {
  doneFiles: number;
  totalFiles: number;
  currentFile: string;
};

export type DialogueSearchMode = 'auto' | 'full' | 'countOnly';

export interface AppState {
  phase: AppPhase;
  flowNodes: FlowNode[];
  flowEdges: FlowEdge[];
  errorMsg: string;
  fileCount: number;
  parseProgress: ParseProgress | null;
  importRevision: number;
  dialogueSearchMode: DialogueSearchMode;
}

export type AppAction =
  | { type: 'RESET' }
  | { type: 'START_READING'; fileCount: number }
  | { type: 'START_PARSING' }
  | { type: 'PROGRESS'; progress: ParseProgress }
  | { type: 'PARTIAL_PARSE_SUCCESS'; nodes: FlowNode[]; edges: FlowEdge[] }
  | { type: 'PARSE_SUCCESS'; nodes: FlowNode[]; edges: FlowEdge[] }
  | { type: 'SET_DIALOGUE_SEARCH_MODE'; mode: DialogueSearchMode }
  | { type: 'FAIL'; message: string };

export const initialAppState: AppState = {
  phase: 'idle',
  flowNodes: [],
  flowEdges: [],
  errorMsg: '',
  fileCount: 0,
  parseProgress: null,
  importRevision: 0,
  dialogueSearchMode: 'auto',
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
    case 'PARTIAL_PARSE_SUCCESS':
      return {
        ...state,
        phase: 'parsing',
        flowNodes: action.nodes,
        flowEdges: action.edges,
      };
    case 'PARSE_SUCCESS':
      return {
        ...state,
        phase: 'done',
        flowNodes: action.nodes,
        flowEdges: action.edges,
        parseProgress: null,
        importRevision: state.importRevision + 1,
      };
    case 'SET_DIALOGUE_SEARCH_MODE':
      return {
        ...state,
        dialogueSearchMode: action.mode,
      };
    case 'FAIL':
      return { ...state, phase: 'error', errorMsg: action.message, parseProgress: null };
    default:
      return state;
  }
}
