#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outPath = join(root, 'evidence', 'verify-out.txt');
const summaryPath = join(root, 'out', 'summary.json');
const expectedPath = join(root, 'src', 'markers.json');

const expected = JSON.parse(await readFile(expectedPath, 'utf8')).expected;

let summary = null;
let error = null;
try {
  summary = JSON.parse(await readFile(summaryPath, 'utf8'));
} catch (e) {
  error = e instanceof Error ? e.message : String(e);
}

const got = Array.isArray(summary?.markers)
  ? summary.markers.map((m) => String(m)).sort()
  : null;
const want = [...expected].sort();
const ok =
  Array.isArray(got) &&
  got.length === want.length &&
  got.every((m, i) => m === want[i]);

const line = ok
  ? `GUARD-OK markers=${got.length}`
  : `GUARD-FAIL got=${JSON.stringify(got)} want=${JSON.stringify(want)} error=${error ?? 'none'}`;

await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, `${line}\n`);
console.log(line);
process.exit(ok ? 0 : 1);
