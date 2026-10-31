/**
 * src/parser/metrics.ts
 *
 * Storytelling and reading time text metrics computation.
 */

const PAUSE_TAG_REGEX = /\{(?:w|p)(?:=([0-9.]+))?\}/gi;
const TEXT_TAG_STRIP_REGEX = /\{[^}]+\}/g;

export function computeTextStats(
  text: string,
): { wordCount: number; pauseDuration: number } {
  let pauseDuration = 0;
  PAUSE_TAG_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = PAUSE_TAG_REGEX.exec(text)) !== null) {
    pauseDuration += match[1] ? parseFloat(match[1]) : 0;
  }

  TEXT_TAG_STRIP_REGEX.lastIndex = 0;
  const stripped = text.replace(TEXT_TAG_STRIP_REGEX, "");
  const wordCount = stripped.trim() === ""
    ? 0
    : stripped.trim().split(/\s+/).filter(Boolean).length;

  return { wordCount, pauseDuration };
}
