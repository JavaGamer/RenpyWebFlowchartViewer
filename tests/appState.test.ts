import { describe, expect, it } from 'vitest';
import { appReducer, initialAppState } from '../src/application/appState';

describe('appReducer', () => {
  it('transitions to reading with initialized progress', () => {
    const next = appReducer(initialAppState, { type: 'START_READING', fileCount: 2 });
    expect(next.phase).toBe('reading');
    expect(next.parseProgress).toEqual({ doneFiles: 0, totalFiles: 2, currentFile: '' });
  });

  it('transitions to success and clears progress', () => {
    const reading = appReducer(initialAppState, { type: 'START_READING', fileCount: 1 });
    const next = appReducer(reading, { type: 'PARSE_SUCCESS', nodes: [], edges: [] });
    expect(next.phase).toBe('done');
    expect(next.parseProgress).toBeNull();
  });
});
