/**
 * Safe localStorage accessors that guard against restricted/private-mode
 * environments where localStorage may be unavailable or throw.
 */

export function getStoredValue(key: string): string | null {
  try {
    if (typeof globalThis.localStorage === 'undefined') return null;
    return globalThis.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function setStoredValue(key: string, value: string): void {
  try {
    if (typeof globalThis.localStorage === 'undefined') return;
    globalThis.localStorage.setItem(key, value);
  } catch {
    // Ignore storage write failures (e.g., restricted/privacy modes).
  }
}
