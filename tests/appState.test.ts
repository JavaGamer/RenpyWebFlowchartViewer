import { beforeEach, describe, expect, it } from 'vitest';
import { useAppStore } from '../src/application/appStore';

describe('useAppStore', () => {
  beforeEach(() => {
    useAppStore.setState(useAppStore.getInitialState());
  });

  it('transitions to reading with initialized progress', () => {
    useAppStore.getState().startReading(2);
    const state = useAppStore.getState();
    expect(state.phase).toBe('reading');
    expect(state.parseProgress).toEqual({ doneFiles: 0, totalFiles: 2, currentFile: '' });
    expect(state.importRevision).toBe(0);
  });

  it('transitions to success and clears progress', () => {
    useAppStore.getState().startReading(1);
    useAppStore.getState().parseSuccess([], []);
    const state = useAppStore.getState();
    expect(state.phase).toBe('done');
    expect(state.parseProgress).toBeNull();
    expect(state.parseWarnings).toEqual([]);
    expect(state.importRevision).toBe(1);
  });

  it('updates dialogue search mode', () => {
    useAppStore.getState().setDialogueSearchMode('countOnly');
    expect(useAppStore.getState().dialogueSearchMode).toBe('countOnly');
  });

  it('resets to initial state', () => {
    useAppStore.getState().startReading(5);
    useAppStore.getState().reset();
    const state = useAppStore.getState();
    expect(state.phase).toBe('idle');
    expect(state.fileCount).toBe(0);
    expect(state.parseProgress).toBeNull();
  });
});
