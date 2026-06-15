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
