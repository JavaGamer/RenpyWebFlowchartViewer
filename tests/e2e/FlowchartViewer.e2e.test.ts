import { chromium } from "playwright";
import { describe, expect, it } from "vitest";
import { createServer } from "vite";
import type { ViteDevServer } from "vite";

describe("Flowchart Viewer E2E Tests", () => {
  const isWindowsDeno = process.platform === "win32" &&
    "Deno" in globalThis;

  it.skipIf(isWindowsDeno)(
    "should load the app, upload a mock .rpy file, and display parsed stats",
    async () => {
      // 1. Programmatically start Vite dev server with project config but root base
      const server: ViteDevServer = await createServer({
        server: { port: 5173 },
        base: "/",
      });
      await server.listen();

      let browser;
      try {
        // 2. Launch headless browser
        browser = await chromium.launch({ headless: true });
        const page = await browser.newPage();

        // Log page errors and console messages for debugging
        page.on("pageerror", (err) => {
          console.error("Browser Page Error:", err);
        });
        page.on("console", (msg) => {
          console.log(`Browser Console [${msg.type()}]:`, msg.text());
        });

        // 3. Navigate to local app
        await page.goto("http://localhost:5173");

        // 4. Assert page title or header
        const header = page.locator("h1");
        const headerText = await header.textContent();
        expect(headerText).toContain("Ren'Py Web Flowchart Viewer");

        // 5. Create a mock .rpy file and upload it
        await page.locator("input#files-input").setInputFiles([
          {
            name: "test_script.rpy",
            mimeType: "text/plain",
            buffer: Buffer.from(
              'label start:\n    "Hello, world!"\n    jump ending\nlabel ending:\n    return\n',
            ),
          },
        ]);

        // 6. Wait for parse success and assert stats
        const statsNode = page.locator("text=Parsed");
        await statsNode.waitFor({ state: "visible", timeout: 15000 });
        expect(await statsNode.isVisible()).toBe(true);

        const nodeCountText = page.locator("text=Nodes").first();
        await nodeCountText.waitFor({ state: "visible", timeout: 5000 });
        expect(await nodeCountText.isVisible()).toBe(true);

        // 7. Verify search functionality works
        const searchInput = page.locator("input[placeholder*='Search']");
        if (await searchInput.isVisible()) {
          await searchInput.fill("start");
          await page.keyboard.press("Enter");
        }
      } finally {
        // 8. Clean up resources
        if (browser) {
          await browser.close();
        }
        await server.close();
      }
    },
    20000,
  ); // 20s timeout for E2E
});
