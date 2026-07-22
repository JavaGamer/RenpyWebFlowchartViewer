/**
 * src/ui/utils/readingTime.ts
 *
 * Utility functions for computing and formatting reading time estimates
 * based on dialogue word counts, explicit pause durations (from Ren'Py
 * pause tags like {w=2.5}), and a configurable words-per-minute speed.
 */

/**
 * Computes estimated reading time in seconds.
 *
 * @param wordCount - Number of words across dialogue lines.
 * @param pauseDuration - Total explicit pause time in seconds (from {w=N} / {p=N} tags).
 * @param wpm - Reading speed in words per minute (e.g. 200).
 * @returns Total estimated reading time in seconds.
 */
export function calculateReadingTimeSeconds(
  wordCount: number,
  pauseDuration: number,
  wpm: number,
): number {
  if (wordCount <= 0 && pauseDuration <= 0) return 0;
  const effectiveWpm = Math.max(1, wpm);
  const readingSeconds = (wordCount / effectiveWpm) * 60;
  return readingSeconds + pauseDuration;
}

/**
 * Formats a duration in seconds to a human-readable string.
 *
 * Examples:
 * - 45 => "45s"
 * - 90 => "1m 30s"
 * - 3661 => "1h 1m"
 * - 0 => "0s"
 */
export function formatReadingTime(seconds: number): string {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) {
    return "0s";
  }
  const totalSeconds = Math.round(seconds);
  if (totalSeconds <= 0) return "0s";

  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;

  if (h > 0) {
    // For hours, only show minutes (skip seconds for brevity)
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  if (m > 0) {
    return s > 0 ? `${m}m ${s}s` : `${m}m`;
  }
  return `${s}s`;
}
