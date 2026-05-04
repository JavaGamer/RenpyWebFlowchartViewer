import { describe, expect, it } from 'vitest';
import { toFileReadErrorMessage, toParseErrorMessage } from '../src/application/errorMessages';
import { FileReadError } from '../src/infrastructure/fileReader';

describe('toFileReadErrorMessage', () => {
  it('returns the message from a FileReadError verbatim', () => {
    const err = new FileReadError('script.rpy');
    expect(toFileReadErrorMessage(err)).toBe(
      'Could not read "script.rpy". The file may be inaccessible or corrupted.',
    );
  });

  it('wraps a generic Error message', () => {
    const err = new Error('disk full');
    expect(toFileReadErrorMessage(err)).toBe(
      'An unexpected error occurred while reading files: disk full',
    );
  });

  it('wraps a string thrown as an error', () => {
    expect(toFileReadErrorMessage('network timeout')).toBe(
      'An unexpected error occurred while reading files: network timeout',
    );
  });

  it('wraps null/undefined thrown as an error', () => {
    expect(toFileReadErrorMessage(null)).toBe(
      'An unexpected error occurred while reading files: null',
    );
    expect(toFileReadErrorMessage(undefined)).toBe(
      'An unexpected error occurred while reading files: undefined',
    );
  });

  it('treats a DOMException as a generic error (not file-read specific)', () => {
    const err = new DOMException('aborted', 'AbortError');
    const msg = toFileReadErrorMessage(err);
    expect(msg).toMatch(/An unexpected error occurred while reading files:/);
  });
});

describe('toParseErrorMessage', () => {
  it('returns cancellation message for a DOMException with name AbortError', () => {
    const err = new DOMException('Parsing cancelled', 'AbortError');
    expect(toParseErrorMessage(err)).toBe('Parsing was cancelled.');
  });

  it('does not treat a DOMException with a different name as an abort', () => {
    const err = new DOMException('something else', 'NetworkError');
    const msg = toParseErrorMessage(err);
    expect(msg).toMatch(/Failed to parse Ren'Py scripts:/);
  });

  it('wraps a generic Error message with parse failure context', () => {
    const err = new Error('unexpected token');
    expect(toParseErrorMessage(err)).toBe(
      "Failed to parse Ren'Py scripts: unexpected token. Ensure your .rpy files contain valid Ren'Py syntax.",
    );
  });

  it('wraps a string thrown as a parse error', () => {
    expect(toParseErrorMessage('bad input')).toBe(
      "Failed to parse Ren'Py scripts: bad input. Ensure your .rpy files contain valid Ren'Py syntax.",
    );
  });

  it('wraps a numeric value thrown as a parse error', () => {
    expect(toParseErrorMessage(42)).toBe(
      "Failed to parse Ren'Py scripts: 42. Ensure your .rpy files contain valid Ren'Py syntax.",
    );
  });
});
