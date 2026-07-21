import { FileReadError, ParseError } from "../domain/index.ts";

export function toFileReadErrorMessage(err: unknown): string {
  if (err instanceof FileReadError) {
    return err.message;
  }
  const detail = err instanceof Error ? err.message : String(err);
  return `An unexpected error occurred while reading files: ${detail}`;
}

export function toParseErrorMessage(err: unknown): string {
  if (
    (err instanceof DOMException && err.name === "AbortError") ||
    (err instanceof Error && err.name === "AbortError") ||
    (typeof err === "object" && err !== null && (err as { name?: string }).name === "AbortError")
  ) {
    return "Parsing was cancelled.";
  }
  if (err instanceof ParseError) {
    return err.message;
  }
  const detail = err instanceof Error ? err.message : String(err);
  return `Failed to parse Ren'Py scripts: ${detail}. Ensure your .rpy files contain valid Ren'Py syntax.`;
}
