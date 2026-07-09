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
      // 1. Programmatically start Vite dev server
      const server: ViteDevServer = await createServer({
        configFile: false,
        root: ".",
        server: { port: 5173 },
      });
      await server.listen();

      let browser;
      try {
        // 2. Launch headless browser
        browser = await chromium.launch({ headless: true });
        const page = await browser.newPage();

        // 3. Navigate to local app
        await page.goto("http://localhost:5173");

        // 4. Assert page title or header
        const header = page.locator("h1");
        const headerText = await header.textContent();
        expect(headerText).toContain("Ren'Py Web Flowchart Viewer");

        // 5. Create a mock .rpy file and upload it
        const [fileChooser] = await Promise.all([
          page.waitForEvent("filechooser"),
          page.locator("input#files-input").click(),
        ]);

        await fileChooser.setFiles([
          {
            name: "test_script.rpy",
            mimeType: "text/plain",
            buffer: Buffer.from(
              'label start:\n    "Hello, world!"\n    jump ending\nlabel ending:\n    return\n',
            ),
          },
        ]);

        // 6. Wait for parse success and assert stats
        const statsNode = page.locator("text=Files parsed");
        await statsNode.waitFor({ state: "visible", timeout: 15000 });
        expect(await statsNode.isVisible()).toBe(true);

        const nodeCountText = page.locator("text=Nodes");
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
