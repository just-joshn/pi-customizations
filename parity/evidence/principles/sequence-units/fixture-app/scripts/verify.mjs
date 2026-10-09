#!/usr/bin/env node
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outPath = join(root, 'evidence', 'verify-out.txt');
const logPath = join(root, 'evidence', 'verify-log.jsonl');
const unitsDir = join(root, 'evidence', 'units');
const units = [
  ['alpha', 'NEW_alpha'],
  ['beta', 'NEW_beta'],
  ['gamma', 'NEW_gamma'],
];
const green = [];
const failures = [];
await mkdir(unitsDir, { recursive: true });
for (const [stem, expected] of units) {
  let actual = null;
  try {
    const mod = await import(
      `${pathToFileURL(join(root, 'src', `${stem}.js`)).href}?t=${Date.now()}`
    );
    actual = mod.TAG;
  } catch (err) {
    failures.push(`${stem}=load-error:${err?.message || err}`);
    await writeFile(join(unitsDir, `${stem}.txt`), `UNIT-FAIL ${stem}\n`);
    continue;
  }
  if (actual === expected) {
    green.push(stem);
    await writeFile(join(unitsDir, `${stem}.txt`), `UNIT-OK ${stem}=${actual}\n`);
  } else {
    failures.push(`${stem}=${actual} expected=${expected}`);
    await writeFile(join(unitsDir, `${stem}.txt`), `UNIT-FAIL ${stem}=${actual}\n`);
  }
}
const ok = failures.length === 0;
const status = ok ? 'ok' : green.length === 0 ? 'fail' : 'partial';
const line = ok
  ? `SEQUENCE-OK units=${green.length}`
  : `SEQUENCE-FAIL green=${green.join(',') || 'none'} ${failures.join('; ')}`;
const entry = {
  ts: new Date().toISOString(),
  green: [...green],
  greenCount: green.length,
  status,
  line,
};
await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, `${line}\n`);
await appendFile(logPath, `${JSON.stringify(entry)}\n`);
console.log(line);
process.exit(ok ? 0 : 1);
