import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve, relative, extname } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '..');
const srcRoot = resolve(repoRoot, 'src');

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
      } else if ((extname(entry.name) === '.ts' || extname(entry.name) === '.tsx') && !entry.name.endsWith('.d.ts')) {
        files.push(fullPath);
      }
    }
  }
  return files;
}

const tsFiles = listSourceFiles(srcRoot);

function relativeFromSrc(file: string): string {
  return relative(srcRoot, file).replaceAll('\\', '/');
}

const legacyTypesImportPattern = /from ['"](?:\.\.?\/)+(?:src\/)?types(?:\/index)?['"]/;
const infraForbiddenImportPattern = /from ['"](?:\.\.?\/)+(?:ui|application)\//;
const parserUiForbiddenImportPattern = /from ['"](?:\.\.?\/)+ui\//;

describe('architecture import boundaries', () => {
  it('disallows legacy src/types entrypoint imports', () => {
    const offenders: string[] = [];
    for (const file of tsFiles) {
      const rel = relativeFromSrc(file);
      const source = readFileSync(file, 'utf8');
      if (legacyTypesImportPattern.test(source)) {
        offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('disallows infrastructure importing from ui or app layers', () => {
    const offenders: string[] = [];
    for (const file of tsFiles) {
      const rel = relativeFromSrc(file);
      if (!rel.startsWith('infrastructure/')) continue;
      const source = readFileSync(file, 'utf8');
      if (infraForbiddenImportPattern.test(source)) {
        offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('disallows parser modules importing from ui layer', () => {
    const offenders: string[] = [];
    for (const file of tsFiles) {
      const rel = relativeFromSrc(file);
      if (!rel.startsWith('parser/')) continue;
      const source = readFileSync(file, 'utf8');
      if (parserUiForbiddenImportPattern.test(source)) {
        offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });
});
