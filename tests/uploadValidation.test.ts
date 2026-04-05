import { describe, expect, it } from 'vitest';
import { validateRpyUpload } from '../src/application/uploadValidation';

function toFileList(files: File[]): FileList {
  return {
    length: files.length,
    item: (index: number) => files[index] ?? null,
    [Symbol.iterator]: function* iterator() {
      yield* files;
    },
    ...files.reduce<Record<number, File>>((acc, file, idx) => {
      acc[idx] = file;
      return acc;
    }, {}),
  } as unknown as FileList;
}

function makeRpy(name: string, size = 32): File {
  return new File([new Uint8Array(size)], name, { type: 'text/plain' });
}

describe('validateRpyUpload', () => {
  it('returns no error for null file list', () => {
    expect(validateRpyUpload(null)).toEqual({ rpyFiles: [], errorMessage: null });
  });

  it('returns an error when no .rpy files are present', () => {
    const files = toFileList([new File(['x'], 'notes.txt', { type: 'text/plain' })]);
    expect(validateRpyUpload(files).errorMessage).toMatch(/No \.rpy files found/i);
  });

  it('returns matching .rpy files when valid', () => {
    const files = toFileList([makeRpy('a.rpy'), makeRpy('b.rpy')]);
    const result = validateRpyUpload(files);
    expect(result.errorMessage).toBeNull();
    expect(result.rpyFiles).toHaveLength(2);
  });
});
