// Stub for Node.js `console` module — provides the same interface as the
// browser global `console` so that @renpy/ast's tokenizer works in the browser.
export const assert = (condition?: boolean, ...data: unknown[]): void => {
  if (!condition) {
    console.error("Assertion failed:", ...data);
  }
};
export const log = (...args: unknown[]) => console.log(...args);
export const warn = (...args: unknown[]) => console.warn(...args);
export const error = (...args: unknown[]) => console.error(...args);
export const debug = (...args: unknown[]) => console.debug(...args);
export const info = (...args: unknown[]) => console.info(...args);
export default { assert, log, warn, error, debug, info };
