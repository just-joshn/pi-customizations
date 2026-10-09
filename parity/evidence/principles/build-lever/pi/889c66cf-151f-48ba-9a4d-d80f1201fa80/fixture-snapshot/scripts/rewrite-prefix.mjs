#!/usr/bin/env node
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const src = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
for (const file of (await readdir(src)).filter((f) => f.endsWith('.js'))) {
  const path = join(src, file);
  const stem = file.slice(0, -3);
  const text = await readFile(path, 'utf8');
  const next = text.replace(/export const TAG = '[^']*';/, `export const TAG = 'APP_${stem}';`);
  if (next !== text) await writeFile(path, next);
}
