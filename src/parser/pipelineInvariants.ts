export function assertInvariant(
  condition: boolean,
  message: string,
): asserts condition {
  if (!condition) {
    throw new Error(`[parser] Internal invariant failed: ${message}`);
  }
}
