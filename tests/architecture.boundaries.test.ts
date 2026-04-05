import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { globSync } from 'node:fs';
import { resolve, relative } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '..');
const srcRoot = resolve(repoRoot, 'src');

const tsFiles = globSync('**/*.{ts,tsx}', {
  cwd: srcRoot,
}).map((file) => resolve(srcRoot, file)).filter((file) => !file.endsWith('.d.ts'));

function relativeFromSrc(file: string): string {
  return relative(srcRoot, file).replaceAll('\\', '/');
}

describe('architecture import boundaries', () => {
  it('disallows legacy src/types entrypoint imports', () => {
    const offenders: string[] = [];
    for (const file of tsFiles) {
      const rel = relativeFromSrc(file);
      const source = readFileSync(file, 'utf8');
      if (source.includes("from './types'") || source.includes('from "../types"') || source.includes('from "../src/types"') || source.includes('from "./src/types"')) {
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
      if (
        source.match(/from ['"]\.\.\/ui\//) ||
        source.match(/from ['"]\.\.\/application\//) ||
        source.match(/from ['"]\.\/ui\//) ||
        source.match(/from ['"]\.\/application\//)
      ) {
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
      if (source.match(/from ['"]\.\.\/ui\//) || source.match(/from ['"]\.\/ui\//)) {
        offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });
});
