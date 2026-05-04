import { describe, expect, it } from 'vitest';
import { validateRpyUpload } from '../src/application/uploadValidation';
import {
  MAX_RPY_FILE_COUNT,
  MAX_RPY_FILE_SIZE_BYTES,
  MAX_TOTAL_RPY_SIZE_BYTES,
} from '../src/config/uploadLimits';

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

  it('returns empty rpyFiles alongside the error for zero matching files', () => {
    const files = toFileList([new File(['x'], 'readme.md')]);
    const result = validateRpyUpload(files);
    expect(result.rpyFiles).toEqual([]);
  });

  it('returns matching .rpy files when valid', () => {
    const files = toFileList([makeRpy('a.rpy'), makeRpy('b.rpy')]);
    const result = validateRpyUpload(files);
    expect(result.errorMessage).toBeNull();
    expect(result.rpyFiles).toHaveLength(2);
  });

  it('accepts .rpy files case-insensitively', () => {
    const files = toFileList([makeRpy('SCRIPT.RPY')]);
    const result = validateRpyUpload(files);
    expect(result.errorMessage).toBeNull();
    expect(result.rpyFiles).toHaveLength(1);
    expect(result.rpyFiles[0]?.name).toBe('SCRIPT.RPY');
  });

  it('filters out non-rpy files and only returns .rpy files', () => {
    const files = toFileList([
      makeRpy('a.rpy'),
      new File(['txt'], 'notes.txt'),
      makeRpy('b.rpy'),
      new File(['js'], 'script.js'),
    ]);
    const result = validateRpyUpload(files);
    expect(result.errorMessage).toBeNull();
    expect(result.rpyFiles).toHaveLength(2);
    expect(result.rpyFiles.map((f) => f.name)).toEqual(['a.rpy', 'b.rpy']);
  });

  it('returns an error when .rpy file count exceeds the limit', () => {
    const files = toFileList(
      Array.from({ length: MAX_RPY_FILE_COUNT + 1 }, (_, i) => makeRpy(`f${i}.rpy`)),
    );
    const result = validateRpyUpload(files);
    expect(result.errorMessage).toMatch(new RegExp(String(MAX_RPY_FILE_COUNT)));
    expect(result.rpyFiles).toEqual([]);
  });

  it('accepts exactly MAX_RPY_FILE_COUNT .rpy files', () => {
    const files = toFileList(
      Array.from({ length: MAX_RPY_FILE_COUNT }, (_, i) => makeRpy(`f${i}.rpy`)),
    );
    const result = validateRpyUpload(files);
    expect(result.errorMessage).toBeNull();
    expect(result.rpyFiles).toHaveLength(MAX_RPY_FILE_COUNT);
  });

  it('returns an error when total .rpy size exceeds the limit', () => {
    // Create two files whose combined size just exceeds the limit.
    const halfPlus = Math.floor(MAX_TOTAL_RPY_SIZE_BYTES / 2) + 1;
    const files = toFileList([
      new File([new Uint8Array(halfPlus)], 'a.rpy'),
      new File([new Uint8Array(halfPlus)], 'b.rpy'),
    ]);
    const result = validateRpyUpload(files);
    expect(result.errorMessage).toMatch(/exceeds the 25 MiB import limit/i);
    expect(result.rpyFiles).toEqual([]);
  });

  it('accepts files whose total size is below the limit', () => {
    // Use two small files well within both per-file and total size limits.
    const files = toFileList([makeRpy('a.rpy', 1024), makeRpy('b.rpy', 1024)]);
    const result = validateRpyUpload(files);
    expect(result.errorMessage).toBeNull();
    expect(result.rpyFiles).toHaveLength(2);
  });

  it('returns an error when a single .rpy file exceeds the per-file size limit', () => {
    const oversized = new File([new Uint8Array(MAX_RPY_FILE_SIZE_BYTES + 1)], 'huge.rpy');
    const files = toFileList([oversized]);
    const result = validateRpyUpload(files);
    expect(result.errorMessage).toMatch(/huge\.rpy/);
    expect(result.errorMessage).toMatch(/too large/i);
    expect(result.rpyFiles).toEqual([]);
  });

  it('accepts a .rpy file at exactly the per-file size limit', () => {
    const exact = new File([new Uint8Array(MAX_RPY_FILE_SIZE_BYTES)], 'big.rpy');
    const result = validateRpyUpload(toFileList([exact]));
    expect(result.errorMessage).toBeNull();
    expect(result.rpyFiles).toHaveLength(1);
  });

  it('reports the first oversized file name in the per-file error', () => {
    const ok = makeRpy('ok.rpy');
    const bad = new File([new Uint8Array(MAX_RPY_FILE_SIZE_BYTES + 1)], 'bad.rpy');
    const result = validateRpyUpload(toFileList([ok, bad]));
    expect(result.errorMessage).toContain('bad.rpy');
    expect(result.errorMessage).toMatch(/too large/i);
  });
});
