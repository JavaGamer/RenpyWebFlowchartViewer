import { FileReadError } from '../infrastructure/fileReader';

export function toFileReadErrorMessage(err: unknown): string {
  if (err instanceof FileReadError) {
    return err.message;
  }
  const detail = err instanceof Error ? err.message : String(err);
  return `An unexpected error occurred while reading files: ${detail}`;
}

export function toParseErrorMessage(err: unknown): string {
  if (err instanceof DOMException && err.name === 'AbortError') {
    return 'Parsing was cancelled.';
  }
  const detail = err instanceof Error ? err.message : String(err);
  return `Failed to parse Ren'Py scripts: ${detail}. Ensure your .rpy files contain valid Ren'Py syntax.`;
}
