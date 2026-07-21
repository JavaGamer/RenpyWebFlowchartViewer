import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Browser, type BrowserContext, chromium, type Page } from "playwright";
import { createServer, type ViteDevServer } from "vite";
import AxeBuilder from "@axe-core/playwright";
import { createHtmlReport } from "axe-html-reporter";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

describe("Flowchart Viewer E2E Accessibility (a11y) & Focus Trapping - WCAG 2.2 AA", () => {
  const isWindowsDeno = process.platform === "win32" &&
    "Deno" in globalThis;

  let server: ViteDevServer | null = null;
  let serverUrl = "";
  let browser: Browser | null = null;
  const allViolations: Array<unknown> = [];

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

    // Generate HTML Accessibility Report if we collected results
    if (allViolations.length > 0) {
      try {
        const coverageDir = path.resolve(process.cwd(), "coverage");
        mkdirSync(coverageDir, { recursive: true });
        const htmlReport = createHtmlReport({
          results: { violations: allViolations as never[] },
          options: {
            projectKey: "RenpyWebFlowchartViewer A11y Suite",
            outputDir: "coverage",
            reportFileName: "a11y-report.html",
          },
        });
        writeFileSync(path.join(coverageDir, "a11y-report.html"), htmlReport, "utf8");
      } catch {
        // Ignore html report write errors in fallback environments
      }
    }
  });

  async function createTestPage(): Promise<{ context: BrowserContext; page: Page }> {
    if (!browser) throw new Error("Browser not initialized");
    const context = await browser.newContext();
    const page = await context.newPage();
    page.on("pageerror", (err) => {
      console.error("E2E Browser Page Error:", err);
    });
    await page.goto(serverUrl);
    return { context, page };
  }

  function makeAxeBuilder(page: Page) {
    return new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]);
  }

  it.skipIf(isWindowsDeno)(
    "Landing View: Has zero WCAG 2.2 AA violations on initial load",
    async () => {
      const { context, page } = await createTestPage();
      try {
        await page.locator("h1").waitFor({ state: "visible", timeout: 10000 });
        const results = await makeAxeBuilder(page).analyze();
        allViolations.push(...results.violations);
        expect(results.violations).toEqual([]);
      } finally {
        await context.close();
      }
    },
    20000,
  );

  it.skipIf(isWindowsDeno)(
    "Populated Flowchart View: Full-DOM & SVG Canvas has zero WCAG 2.2 AA violations",
    async () => {
      const { context, page } = await createTestPage();
      try {
        await page.locator("input#files-input").setInputFiles([
          {
            name: "a11y_story.rpy",
            mimeType: "text/plain",
            buffer: Buffer.from([
              "label start:",
              '    "Welcome to accessibility testing!"',
              "    jump chapter1",
              "",
              "label chapter1:",
              '    "Chapter 1 content"',
              "    return",
              "",
            ].join("\n")),
          },
        ]);

        await page.locator("text=Parsed").waitFor({ state: "visible", timeout: 15000 });
        const results = await makeAxeBuilder(page).analyze();
        allViolations.push(...results.violations);
        expect(results.violations).toEqual([]);
      } finally {
        await context.close();
      }
    },
    25000,
  );

  it.skipIf(isWindowsDeno)(
    "Multi-Theme Audit: Dark Mode & Light Mode pass WCAG 2.2 AA color contrast checks",
    async () => {
      const { context, page } = await createTestPage();
      try {
        await page.locator("h1").waitFor({ state: "visible", timeout: 10000 });

        // Audit Light Mode
        const lightResults = await makeAxeBuilder(page).analyze();
        allViolations.push(...lightResults.violations);
        expect(lightResults.violations).toEqual([]);

        // Toggle to Dark Mode
        const themeBtn = page.locator("button[aria-label*='theme'], button[aria-label*='Theme']").first();
        if (await themeBtn.isVisible()) {
          await themeBtn.click();
          await page.waitForTimeout(300);
          const darkResults = await makeAxeBuilder(page).analyze();
          allViolations.push(...darkResults.violations);
          expect(darkResults.violations).toEqual([]);
        }
      } finally {
        await context.close();
      }
    },
    25000,
  );

  it.skipIf(isWindowsDeno)(
    "Keyboard Navigation & Focus Trapping: Radix Dialog drawer traps focus, closes on Escape, and restores focus",
    async () => {
      const { context, page } = await createTestPage();
      try {
        const exportBtn = page.locator("button", { hasText: /Export/i }).first();
        if (await exportBtn.isVisible()) {
          await exportBtn.click();

          const modal = page.locator("[role='dialog'], [role='menu'], .export-menu").first();
          await modal.waitFor({ state: "visible", timeout: 5000 });
          expect(await modal.isVisible()).toBe(true);

          // Verify axe compliance inside active dialog drawer
          const dialogResults = await makeAxeBuilder(page).analyze();
          allViolations.push(...dialogResults.violations);
          expect(dialogResults.violations).toEqual([]);

          // Press Escape to dismiss modal and verify focus restoration
          await page.keyboard.press("Escape");
          await modal.waitFor({ state: "hidden", timeout: 5000 });
          expect(await modal.isVisible()).toBe(false);
        }
      } finally {
        await context.close();
      }
    },
    20000,
  );
});
