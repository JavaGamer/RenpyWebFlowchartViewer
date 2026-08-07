import { describe, expect, it } from "vitest";

describe("Playwright Library in Vitest", () => {
  const isWindowsDeno = process.platform === "win32" &&
    "Deno" in globalThis;

  it.skipIf(isWindowsDeno)(
    "should launch chromium and get version",
    async () => {
      const { chromium } = await import("playwright");
      const browser = await chromium.launch({ headless: true });
      const version = browser.version();
      console.log("Chromium version:", version);
      expect(version).toBeTruthy();
      await browser.close();
    },
  );
});
