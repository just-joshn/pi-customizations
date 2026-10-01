import { expect, test } from 'bun:test';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = new URL('../../', import.meta.url).pathname;
const overlayNames = (await readdir(join(root, 'scripts/overlays'))).filter((name) => name.endsWith('.mjs'));
const overlays = (await Promise.all(overlayNames.map((name) => import(join(root, 'scripts/overlays', name))))).flatMap((module) => module.default);

test('every helper overlay edit is present in the shipped helper file', async () => {
  const missing: string[] = [];
  for (const overlay of overlays) {
    const shipped = await readFile(join(root, overlay.path), 'utf8');
    for (const [, to] of overlay.edits) if (!shipped.includes(to)) missing.push(`${overlay.path}: ${to.slice(0, 60)}`);
  }
  expect(missing).toEqual([]);
});
