import { chromium } from "playwright";
import { describe, expect, it } from "vitest";

describe("Playwright Library in Vitest", () => {
  it("should launch chromium and get version", async () => {
    const browser = await chromium.launch({ headless: true });
    const version = browser.version();
    console.log("Chromium version:", version);
    expect(version).toBeTruthy();
    await browser.close();
  });
});
