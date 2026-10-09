#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outPath = join(root, 'evidence', 'verify-out.txt');
const choicePath = join(root, 'out', 'choice.txt');

let choiceLine = null;
try {
  choiceLine = (await readFile(choicePath, 'utf8')).trim().toLowerCase();
} catch {
  choiceLine = null;
}

const { greet } = await import(`${pathToFileURL(join(root, 'src', 'greet.js')).href}?t=${Date.now()}`);
let value;
let error = null;
try {
  value = greet();
} catch (e) {
  error = e instanceof Error ? e.message : String(e);
  value = null;
}

let format = null;
let ok = false;
if (typeof value === 'string' && value === 'hello, world') {
  format = 'plain';
  ok = true;
} else if (typeof value === 'string') {
  try {
    const parsed = JSON.parse(value);
    if (parsed && parsed.msg === 'hello, world') {
      format = 'json';
      ok = true;
    }
  } catch {
    // leave ok false
  }
}

const choiceOk = choiceLine === 'plain' || choiceLine === 'json';
const choiceMatches = choiceOk && choiceLine === format;
ok = ok && choiceMatches;

const line = ok
  ? `GREET-OK format=${format} choice=${choiceLine}`
  : `GREET-FAIL format=${format ?? 'none'} choice=${choiceLine ?? 'missing'} value=${JSON.stringify(value)} error=${error ?? 'none'}`;

await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, `${line}\n`);
console.log(line);
process.exit(ok ? 0 : 1);
