#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outPath = join(root, 'evidence', 'verify-out.txt');
const units = [
  ['alpha', 'APP_alpha'],
  ['beta', 'APP_beta'],
  ['gamma', 'APP_gamma'],
];
const failures = [];
for (const [stem, expected] of units) {
  const mod = await import(`${pathToFileURL(join(root, 'src', `${stem}.js`)).href}?t=${Date.now()}`);
  if (mod.TAG !== expected) failures.push(`${stem}=${mod.TAG} expected=${expected}`);
}
const ok = failures.length === 0;
const line = ok ? 'PREFIX-OK units=3' : `PREFIX-FAIL ${failures.join('; ')}`;
await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, `${line}\n`);
console.log(line);
process.exit(ok ? 0 : 1);
