// Workaround for Deno + elkjs: Deno defines globalThis.self, which confuses elkjs worker detection.
if (typeof (globalThis as unknown as { self: unknown }).self !== "undefined") {
  try {
    delete (globalThis as unknown as { self: unknown }).self;
  } catch {
    // ignore if read-only
  }
}

import * as matchers from "@testing-library/jest-dom/matchers";
import { expect } from "vitest";
expect.extend(matchers);

// Ensure React's act() integration is enabled in the Vitest + jsdom environment.
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

// Polyfill Deno's node:worker_threads missing parentPort.removeAllListeners
try {
  const workerThreads = await import("node:worker_threads");
  if (
    workerThreads.parentPort &&
    typeof (workerThreads.parentPort as unknown as { removeAllListeners?: unknown })
      .removeAllListeners !== "function"
  ) {
    (workerThreads.parentPort as unknown as { removeAllListeners: () => void })
      .removeAllListeners = () => {};
  }
} catch {
  // Ignore
}

