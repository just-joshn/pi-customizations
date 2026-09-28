#!/usr/bin/env node
// Extracts a name/version inventory from either lock format so the npm tree and
// the Bun tree can be diffed package by package.
//
//   node lock-inventory.mjs <npm|bun> <lockfile> <out.tsv>
import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';

const [format, lockfile, out] = process.argv.slice(2);
if (!format || !lockfile || !out) {
  process.stderr.write('usage: lock-inventory.mjs <npm|bun> <lockfile> <out.tsv>\n');
  process.exit(1);
}

const text = readFileSync(lockfile, 'utf8');
const rows = [];

if (format === 'npm') {
  const lock = JSON.parse(text);
  for (const [path, entry] of Object.entries(lock.packages ?? {})) {
    if (!path || !entry.version) continue;
    rows.push([path.replace(/^.*node_modules\//, ''), entry.version]);
  }
} else if (format === 'bun') {
  const start = text.indexOf('"packages": {');
  if (start < 0) throw new Error('no packages section in bun.lock');
  const body = text.slice(start);
  const entry = /^\s{4}"((?:[^"\\]|\\.)+)": \[\s*"((?:[^"\\]|\\.)+)"/gm;
  for (const [, , spec] of body.matchAll(entry)) {
    if (spec.startsWith('workspace:')) continue;
    const at = spec.lastIndexOf('@');
    if (at <= 0) continue;
    rows.push([spec.slice(0, at), spec.slice(at + 1)]);
  }
} else {
  throw new Error(`unknown format ${format}`);
}

rows.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
writeFileSync(out, `${rows.map(([name, version]) => `${name}\t${version}`).join('\n')}\n`);
process.stdout.write(`${basename(out)}: ${rows.length} packages\n`);
