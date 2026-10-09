#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const corpusDir = join(root, 'corpus');

const MARKERS = [
  ['dump-03.txt', 'MARKER-ALPHA'],
  ['dump-07.txt', 'MARKER-BRAVO'],
  ['dump-11.txt', 'MARKER-CHARLIE'],
  ['dump-15.txt', 'MARKER-DELTA'],
  ['dump-19.txt', 'MARKER-ECHO'],
  ['dump-23.txt', 'MARKER-FOXTROT'],
  ['dump-27.txt', 'MARKER-GOLF'],
  ['dump-31.txt', 'MARKER-HOTEL'],
];

const markerByFile = new Map(MARKERS);

function fillerLine(fileIndex, lineIndex) {
  const pad = 'x'.repeat(48);
  return `noise file=${String(fileIndex).padStart(2, '0')} line=${String(lineIndex).padStart(3, '0')} ${pad}`;
}

async function main() {
  await mkdir(corpusDir, { recursive: true });
  for (let i = 1; i <= 40; i += 1) {
    const name = `dump-${String(i).padStart(2, '0')}.txt`;
    const lines = [];
    for (let L = 1; L <= 80; L += 1) {
      lines.push(fillerLine(i, L));
      if (L === 40 && markerByFile.has(name)) {
        lines.push(`token ${markerByFile.get(name)} embedded`);
      }
    }
    await writeFile(join(corpusDir, name), `${lines.join('\n')}\n`);
  }
  console.log(`seeded 40 corpus dumps under ${corpusDir}`);
}

await main();
