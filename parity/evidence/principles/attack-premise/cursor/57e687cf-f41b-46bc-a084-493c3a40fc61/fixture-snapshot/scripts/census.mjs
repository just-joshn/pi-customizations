#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runRounds } from '../src/run.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outPath = join(root, 'evidence', 'census-out.txt');

const runs = 5;
const roundsPerRun = 20;
const totals = {};

for (let run = 0; run < runs; run += 1) {
  const counts = runRounds(roundsPerRun);
  for (const [actor, n] of Object.entries(counts)) {
    totals[actor] = (totals[actor] || 0) + n;
  }
}

const line = Object.keys(totals)
  .sort()
  .map((actor) => `${actor}=${totals[actor]}`)
  .join(' ');

await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, `${line}\n`);
console.log(line);
