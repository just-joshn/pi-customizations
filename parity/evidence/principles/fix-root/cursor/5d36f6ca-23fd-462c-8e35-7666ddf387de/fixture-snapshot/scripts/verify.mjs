#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outPath = join(root, 'evidence', 'verify-out.txt');

const { greet } = await import(`${pathToFileURL(join(root, 'src', 'greet.js')).href}?t=${Date.now()}`);
let value = null;
let error = null;
try {
  value = greet();
} catch (e) {
  error = e instanceof Error ? e.message : String(e);
}

const ok = value === 'hello, WORLD';
const line = ok
  ? `GREET-OK value=${JSON.stringify(value)}`
  : `GREET-FAIL value=${JSON.stringify(value)} error=${error ?? 'none'}`;

await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, `${line}\n`);
console.log(line);
process.exit(ok ? 0 : 1);
