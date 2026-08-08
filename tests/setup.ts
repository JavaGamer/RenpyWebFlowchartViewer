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
    typeof (workerThreads.parentPort as unknown as {
        removeAllListeners?: unknown;
      })
        .removeAllListeners !== "function"
  ) {
    (workerThreads.parentPort as unknown as { removeAllListeners: () => void })
      .removeAllListeners = () => {};
  }
} catch {
  // Ignore
}

function patchDispatch(
  proto: { dispatchEvent: typeof EventTarget.prototype.dispatchEvent },
) {
  const orig = proto.dispatchEvent;
  if (!orig) return;
  proto.dispatchEvent = function (event: Event) {
    try {
      return orig.call(this, event);
    } catch (err: unknown) {
      const msg = String((err as { message?: string })?.message || err);
      if (
        msg.includes("not of type 'Event'") &&
        event &&
        typeof (event as unknown as { type: string }).type === "string"
      ) {
        const nativeEvent = new Event(
          (event as unknown as { type: string }).type,
          {
            bubbles: event.bubbles,
            cancelable: event.cancelable,
            composed: event.composed,
          },
        );
        for (const prop of Object.getOwnPropertyNames(event)) {
          try {
            (nativeEvent as unknown as Record<string, unknown>)[prop] =
              (event as unknown as Record<string, unknown>)[prop];
          } catch {
            // ignore read-only properties
          }
        }
        return orig.call(this, nativeEvent);
      }
      throw err;
    }
  };
}

if (typeof EventTarget !== "undefined" && EventTarget.prototype) {
  patchDispatch(EventTarget.prototype);
}
if (typeof globalThis !== "undefined") {
  patchDispatch(
    globalThis as unknown as {
      dispatchEvent: typeof EventTarget.prototype.dispatchEvent;
    },
  );
}
if (typeof window !== "undefined") {
  if (window.EventTarget && window.EventTarget.prototype) {
    patchDispatch(window.EventTarget.prototype);
  }
  patchDispatch(
    window as unknown as {
      dispatchEvent: typeof EventTarget.prototype.dispatchEvent;
    },
  );
}
