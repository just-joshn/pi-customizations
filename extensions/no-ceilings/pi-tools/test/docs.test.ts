import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const packageRoot = path.join(import.meta.dirname, '..');

async function read(relative: string): Promise<string> {
  return readFile(path.join(packageRoot, relative), 'utf8');
}

describe('published docs match the tree', () => {
  it('every `suite > test` citation in the parity matrix names a real test', async () => {
    const [matrix, ...testFiles] = await Promise.all([
      read('docs/parity.md'),
      ...(await import('node:fs/promises').then((fs) => fs.readdir(path.join(packageRoot, 'test')))).filter((name) => name.endsWith('.test.ts')).map((name) => read(path.join('test', name))),
    ]);
    const tests = testFiles.join('\n');
    const citations = new Set<string>();
    for (const match of matrix.matchAll(/`([^`>\n]+) > ([^`\n]+)`/g)) {
      const suite = match[1];
      const name = match[2];
      if (suite !== undefined && name !== undefined) {
        citations.add(`${suite}\u0000${name}`);
      }
    }
    expect(citations.size).toBeGreaterThan(40);
    const missing = [...citations].filter((citation) => {
      const [suite, name] = citation.split('\u0000');
      return suite === undefined || name === undefined || !tests.includes(`describe('${suite}'`) || !tests.includes(`it('${name}'`);
    });
    expect(missing).toEqual([]);
  });

  it('the parity matrix names only files that exist', async () => {
    const matrix = await read('docs/parity.md');
    const files = new Set([...matrix.matchAll(/`(src\/[^`]+\.ts)`/g)].map((match) => match[1]));
    expect(files.size).toBeGreaterThan(10);
    const missing: string[] = [];
    for (const file of files) {
      if (file === undefined) {
        continue;
      }
      try {
        await readFile(path.join(packageRoot, file), 'utf8');
      } catch {
        missing.push(file);
      }
    }
    expect(missing).toEqual([]);
  });

  it('no shipped source names the process behind the inventory', async () => {
    const { readdir } = await import('node:fs/promises');
    const sources = (await readdir(path.join(packageRoot, 'src'), { recursive: true, withFileTypes: true })).filter((entry) => entry.isFile() && entry.name.endsWith('.ts'));
    const offenders: string[] = [];
    for (const entry of sources) {
      const file = path.join(entry.parentPath, entry.name);
      const body = await readFile(file, 'utf8');
      // Built from parts so the guard does not itself repeat the phrase it forbids.
      const forbidden = new RegExp(['reference', 'harness'].join(' '), 'i');
      if (forbidden.test(body)) {
        offenders.push(path.relative(packageRoot, file));
      }
    }
    expect(offenders).toEqual([]);
  });
});
