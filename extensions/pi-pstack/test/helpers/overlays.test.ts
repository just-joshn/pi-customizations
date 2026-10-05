import './leak-preload.ts';
import { execFileSync } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, test } from 'vitest';

const root = new URL('../../', import.meta.url).pathname;
const overlayNames = (await readdir(join(root, 'scripts/overlays'))).filter((name) => name.endsWith('.mjs'));
const overlays = (await Promise.all(overlayNames.map((name) => import(join(root, 'scripts/overlays', name))))).flatMap((module) => module.default);

test('every helper overlay edit is present in the shipped helper file', async () => {
  const missing: string[] = [];
  for (const overlay of overlays) {
    const shipped = await readFile(join(root, overlay.path), 'utf8');
    for (const [, to] of overlay.edits) {
      expect(shipped).toContain(to);
      if (!shipped.includes(to)) missing.push(`${overlay.path}: ${to.slice(0, 60)}`);
    }
  }
  expect(missing).toEqual([]);
});

test('shipped helpers match the complete resource replay', () => {
  expect(execFileSync(process.execPath, [join(root, 'scripts/resources.mjs')], { encoding: 'utf8' })).toBe('Verified 190 upstream files and 211 generated resources.\n');
});
