#!/usr/bin/env node
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const srcDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const tagLine = /^export const TAG = '[^']*';$/m;

for (const name of (await readdir(srcDir)).filter((n) => n.endsWith('.js')).sort()) {
  const path = join(srcDir, name);
  const before = await readFile(path, 'utf8');
  if (!tagLine.test(before)) throw new Error(`${name}: no TAG export found`);
  const after = before.replace(tagLine, `export const TAG = 'APP_${basename(name, '.js')}';`);
  if (after !== before) await writeFile(path, after);
  console.log(`${name}: ${after === before ? 'unchanged' : 'rewritten'}`);
}
