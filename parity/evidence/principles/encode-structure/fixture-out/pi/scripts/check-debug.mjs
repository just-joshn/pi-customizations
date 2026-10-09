#!/usr/bin/env node
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const src = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const banned = /ALLOW_DEBUG\s*[:=]\s*true\b/;

const offenders = [];
for (const entry of await readdir(src, { recursive: true, withFileTypes: true })) {
  if (!entry.isFile() || !/\.[cm]?js$/.test(entry.name)) continue;
  const file = join(entry.parentPath, entry.name);
  if (banned.test(await readFile(file, 'utf8'))) offenders.push(file);
}

if (offenders.length > 0) {
  console.error(`check-debug fail: ALLOW_DEBUG enabled in ${offenders.join(', ')}`);
  process.exit(1);
}
