import { describe, expect, it } from 'vitest';
import { appReducer, initialAppState } from '../src/application/appState';

describe('appReducer', () => {
  it('transitions to reading with initialized progress', () => {
    const next = appReducer(initialAppState, { type: 'START_READING', fileCount: 2 });
    expect(next.phase).toBe('reading');
    expect(next.parseProgress).toEqual({ doneFiles: 0, totalFiles: 2, currentFile: '' });
    expect(next.importRevision).toBe(0);
  });

  it('transitions to success and clears progress', () => {
    const reading = appReducer(initialAppState, { type: 'START_READING', fileCount: 1 });
    const next = appReducer(reading, { type: 'PARSE_SUCCESS', nodes: [], edges: [] });
    expect(next.phase).toBe('done');
    expect(next.parseProgress).toBeNull();
    expect(next.importRevision).toBe(1);
  });

  it('updates dialogue search mode', () => {
    const next = appReducer(initialAppState, { type: 'SET_DIALOGUE_SEARCH_MODE', mode: 'countOnly' });
    expect(next.dialogueSearchMode).toBe('countOnly');
  });

  it('returns previous state for unknown actions', () => {
    const next = appReducer(initialAppState, { type: 'UNKNOWN_ACTION' } as never);
    expect(next).toBe(initialAppState);
  });
});
