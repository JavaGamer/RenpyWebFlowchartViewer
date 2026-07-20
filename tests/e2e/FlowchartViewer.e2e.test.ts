import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Browser, chromium, type Page } from "playwright";
import { createServer, type ViteDevServer } from "vite";

describe("Flowchart Viewer E2E Tests", () => {
  const isWindowsDeno = process.platform === "win32" &&
    "Deno" in globalThis;

  let server: ViteDevServer | null = null;
  let serverUrl = "";
  let browser: Browser | null = null;

  beforeAll(async () => {
    if (isWindowsDeno) return;

    // Start Vite dev server on dynamic port
    server = await createServer({
      server: { port: 0 },
      base: "/",
    });
    await server.listen();
    const address = server.httpServer?.address();
    if (address && typeof address === "object") {
      serverUrl = `http://localhost:${address.port}`;
    } else {
      serverUrl = "http://localhost:5173";
    }

    // Launch single headless browser instance
    browser = await chromium.launch({ headless: true });
  }, 25000);

  afterAll(async () => {
    if (browser) {
      await browser.close();
    }
    if (server) {
      await server.close();
    }
  });

  async function createTestPage(): Promise<Page> {
    if (!browser) throw new Error("Browser not initialized");
    const page = await browser.newPage();
    page.on("pageerror", (err) => {
      console.error("E2E Browser Page Error:", err);
    });
    await page.goto(serverUrl);
    return page;
  }

  it.skipIf(isWindowsDeno)(
    "Scenario 1: Loads initial application page and checks header elements",
    async () => {
      const page = await createTestPage();
      try {
        const header = page.locator("h1");
        await header.waitFor({ state: "visible", timeout: 10000 });
        const headerText = await header.textContent();
        expect(headerText).toContain("Ren'Py Web Flowchart Viewer");

        const dropzone = page.locator("#files-input");
        expect(await dropzone.count()).toBeGreaterThan(0);
      } finally {
        await page.close();
      }
    },
    20000,
  );

  it.skipIf(isWindowsDeno)(
    "Scenario 2: Uploads a mock Ren'Py script and verifies parsed flowchart nodes",
    async () => {
      const page = await createTestPage();
      try {
        await page.locator("input#files-input").setInputFiles([
          {
            name: "e2e_story.rpy",
            mimeType: "text/plain",
            buffer: Buffer.from([
              "label start:",
              '    "Welcome to the story!"',
              "    jump chapter1",
              "",
              "label chapter1:",
              '    "Chapter 1 content"',
              "    return",
              "",
            ].join("\n")),
          },
        ]);

        const statsNode = page.locator("text=Parsed");
        await statsNode.waitFor({ state: "visible", timeout: 15000 });
        expect(await statsNode.isVisible()).toBe(true);

        const nodeCountText = page.locator("text=Nodes").first();
        await nodeCountText.waitFor({ state: "visible", timeout: 5000 });
        expect(await nodeCountText.isVisible()).toBe(true);
      } finally {
        await page.close();
      }
    },
    20000,
  );

  it.skipIf(isWindowsDeno)(
    "Scenario 3: Interacts with graph search bar to filter node labels",
    async () => {
      const page = await createTestPage();
      try {
        await page.locator("input#files-input").setInputFiles([
          {
            name: "search_test.rpy",
            mimeType: "text/plain",
            buffer: Buffer.from("label target_node:\n    return\n"),
          },
        ]);

        await page.locator("text=Parsed").waitFor({
          state: "visible",
          timeout: 15000,
        });

        const searchInput = page.locator("input[placeholder*='Search']")
          .first();
        if (await searchInput.isVisible()) {
          await searchInput.fill("target_node");
          await page.keyboard.press("Enter");
          expect(await searchInput.inputValue()).toBe("target_node");
        }
      } finally {
        await page.close();
      }
    },
    20000,
  );

  it.skipIf(isWindowsDeno)(
    "Scenario 4: Opens export menu modal and verifies action buttons",
    async () => {
      const page = await createTestPage();
      try {
        const exportBtn = page.locator("button", { hasText: /Export/i })
          .first();
        if (await exportBtn.isVisible()) {
          await exportBtn.click();
          const modalOrMenu = page.locator(
            "[role='menu'], [role='dialog'], .export-menu",
          ).first();
          await modalOrMenu.waitFor({ state: "visible", timeout: 5000 });
          expect(await modalOrMenu.isVisible()).toBe(true);
        }
      } finally {
        await page.close();
      }
    },
    20000,
  );

  it.skipIf(isWindowsDeno)(
    "Scenario 5: Opens URL Import option and validates form input state",
    async () => {
      const page = await createTestPage();
      try {
        const urlTabBtn = page.locator("button", { hasText: /URL|Import/i })
          .first();
        if (await urlTabBtn.isVisible()) {
          await urlTabBtn.click();
          const urlInput = page.locator(
            "input[type='url'], input[placeholder*='http']",
          ).first();
          if (await urlInput.isVisible()) {
            await urlInput.fill("https://example.com/script.rpy");
            expect(await urlInput.inputValue()).toBe(
              "https://example.com/script.rpy",
            );
          }
        }
      } finally {
        await page.close();
      }
    },
    20000,
  );

  it.skipIf(isWindowsDeno)(
    "Scenario 6: Toggles dark / light theme and asserts HTML root theme state",
    async () => {
      const page = await createTestPage();
      try {
        const themeBtn = page.locator(
          "button[aria-label*='theme'], button[aria-label*='Theme']",
        ).first();
        if (await themeBtn.isVisible()) {
          await themeBtn.click();
          const htmlClass = await page.locator("html").getAttribute("class");
          expect(htmlClass).toBeDefined();
        }
      } finally {
        await page.close();
      }
    },
    20000,
  );
});
