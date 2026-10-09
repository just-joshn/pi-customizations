#!/usr/bin/env node
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const corpusDir = join(root, 'corpus');
const summaryPath = join(root, 'out', 'summary.json');

const MARKER_RE = /MARKER-[A-Z0-9]+/g;

async function collectMarkers(dir) {
  const names = await readdir(dir);
  const found = new Set();
  for (const name of names) {
    const text = await readFile(join(dir, name), 'utf8');
    for (const match of text.matchAll(MARKER_RE)) {
      found.add(match[0]);
    }
  }
  return [...found].sort();
}

async function writeSummary(path, markers) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify({ markers }, null, 2)}\n`);
}

async function main() {
  const markers = await collectMarkers(corpusDir);
  await writeSummary(summaryPath, markers);
  console.log(`wrote ${markers.length} markers to out/summary.json`);
}

await main();
