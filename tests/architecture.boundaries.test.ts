import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { extname, relative, resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..");
const srcRoot = resolve(repoRoot, "src");

function listSourceFiles(root: string): string[] {
  const files: string[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const currentDir = stack.pop()!;
    const entries = readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = resolve(currentDir, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (
        (extname(entry.name) === ".ts" || extname(entry.name) === ".tsx") &&
        !entry.name.endsWith(".d.ts")
      ) {
        files.push(fullPath);
      }
    }
  }
  return files;
}

const tsFiles = listSourceFiles(srcRoot);

function relativeFromSrc(file: string): string {
  return relative(srcRoot, file).replaceAll("\\", "/");
}

const legacyTypesImportPattern =
  /from ['"](?:\.\.?\/)+(?:src\/)?types(?:\/index)?['"]/;
const infraForbiddenImportPattern = new RegExp(
  "from ['\"](?:\\.\\.?/)+(?:ui|application)(?:['\"/]|$)",
);
const domainForbiddenImportPattern = new RegExp(
  "from ['\"](?:\\.\\.?/)+(?:ui|application|infrastructure|parser)(?:['\"/]|$)",
);
const layerImportPattern =
  /from ['"]((?:\.\.?\/)+(domain|application|infrastructure|ui|parser)(?:\/[^'"]+)?)['"]/g;

function detectLayer(
  relativePath: string,
):
  | "domain"
  | "application"
  | "infrastructure"
  | "ui"
  | "parser"
  | "config"
  | "other" {
  if (relativePath.startsWith("domain/")) return "domain";
  if (relativePath.startsWith("application/")) return "application";
  if (relativePath.startsWith("infrastructure/")) return "infrastructure";
  if (relativePath.startsWith("ui/")) return "ui";
  if (relativePath.startsWith("parser/")) return "parser";
  if (relativePath.startsWith("config/")) return "config";
  if (relativePath.endsWith(".tsx")) return "ui";
  return "other";
}

describe("architecture import boundaries", () => {
  it("disallows legacy src/types entrypoint imports", () => {
    const offenders: string[] = [];
    for (const file of tsFiles) {
      const rel = relativeFromSrc(file);
      const source = readFileSync(file, "utf8");
      if (legacyTypesImportPattern.test(source)) {
        offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("disallows infrastructure importing from ui or app layers", () => {
    const offenders: string[] = [];
    for (const file of tsFiles) {
      const rel = relativeFromSrc(file);
      if (!rel.startsWith("infrastructure/")) continue;
      const source = readFileSync(file, "utf8");
      if (infraForbiddenImportPattern.test(source)) {
        offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("disallows parser modules importing from application, infrastructure, or ui layers", () => {
    const offenders: string[] = [];
    for (const file of tsFiles) {
      const rel = relativeFromSrc(file);
      if (!rel.startsWith("parser/")) continue;
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(layerImportPattern)) {
        const importPath = match[1];
        const targetLayer = match[2];
        if (
          targetLayer === "ui" ||
          targetLayer === "application" ||
          targetLayer === "infrastructure"
        ) {
          offenders.push(`${rel} -> ${importPath}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("disallows domain modules importing from parser, application, infrastructure, or ui layers", () => {
    const offenders: string[] = [];
    for (const file of tsFiles) {
      const rel = relativeFromSrc(file);
      if (!rel.startsWith("domain/")) continue;
      const source = readFileSync(file, "utf8");
      if (domainForbiddenImportPattern.test(source)) {
        offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("disallows deep cross-layer imports when a layer entrypoint exists", () => {
    const offenders: string[] = [];
    for (const file of tsFiles) {
      const rel = relativeFromSrc(file);
      const sourceLayer = detectLayer(rel);
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(layerImportPattern)) {
        const importPath = match[1];
        const targetLayer = match[2] as
          | "domain"
          | "application"
          | "infrastructure"
          | "ui";
        const normalizedImportPath = importPath.replace(/^(\.\.\/|\.\/)+/, "");
        const isDeepImport = normalizedImportPath !== targetLayer &&
          normalizedImportPath !== `${targetLayer}/index.ts` &&
          normalizedImportPath !== `${targetLayer}/index.tsx` &&
          normalizedImportPath.startsWith(`${targetLayer}/`);
        const isSameLayer = sourceLayer === targetLayer;
        if (isDeepImport && !isSameLayer) {
          offenders.push(`${rel} -> ${importPath}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
