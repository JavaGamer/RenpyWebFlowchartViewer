// Browser stub for node:fs/promises — the @renpy/ast package references this
// module at the top level, but only uses it in the Node-only `parseFile` function.
// We only call the browser-safe `parse(content: string)` API, so this stub is
// never actually invoked at runtime.

export const readFile = (): never => {
  throw new Error('node:fs is not available in the browser');
};

export default { readFile };
