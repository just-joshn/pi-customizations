#!/usr/bin/env node
// Compares the npm lockfile resolutions with the merged Bun resolution.
// Reports per package name which exact versions were dropped and which are new,
// so a reader can see whether the merge changed the dependency graph.
import { readFileSync, writeFileSync } from 'node:fs';

const PACKAGES = ['pi-anthropic-oauth', 'pi-antigravity-oauth', 'pi-one-dark-pro-theme', 'pi-pstack', 'pi-tui-parity'];
const dir = '.audit/bun-migration';

const pairs = (file) => readFileSync(file, 'utf8').trim().split('\n').filter(Boolean)
  .map((line) => { const [name, version] = line.split('\t'); return { name, version }; });

const group = (entries) => {
  const map = new Map();
  for (const { name, version } of entries) {
    if (!map.has(name)) map.set(name, new Set());
    map.get(name).add(version);
  }
  return map;
};

const npm = group(PACKAGES.flatMap((name) => pairs(`${dir}/npm-inventory-${name}.tsv`)));
const bun = group(pairs(`${dir}/bun-inventory.tsv`));

const bumpKind = (from, to) => {
  const a = from.split('.').map(Number);
  const b = to.split('.').map(Number);
  if (a[0] !== b[0]) return 'major';
  if (a[1] !== b[1]) return 'minor';
  return 'patch';
};

const names = [...new Set([...npm.keys(), ...bun.keys()])].sort();
const lines = ['package\tnpm versions\tbun versions\tkind'];
const counts = new Map();
for (const name of names) {
  const before = npm.get(name) ?? new Set();
  const after = bun.get(name) ?? new Set();
  const lost = [...before].filter((version) => !after.has(version)).sort();
  const gained = [...after].filter((version) => !before.has(version)).sort();
  if (!lost.length && !gained.length) continue;
  let kind;
  if (!before.size) kind = 'added';
  else if (!after.size) kind = 'removed';
  else if (lost.length === 1 && gained.length === 1 && before.size === 1 && after.size === 1) kind = bumpKind(lost[0], gained[0]);
  else kind = 'set change';
  counts.set(kind, (counts.get(kind) ?? 0) + 1);
  lines.push(`${name}\t${[...before].sort().join(' ') || '-'}\t${[...after].sort().join(' ') || '-'}\t${kind}`);
}

writeFileSync(`${dir}/dependency-drift.tsv`, `${lines.join('\n')}\n`);
process.stdout.write(`${lines.join('\n')}\n\n`);
process.stdout.write(`npm names ${npm.size}, bun names ${bun.size}\n`);
process.stdout.write(`drift: ${[...counts].map(([kind, n]) => `${kind}=${n}`).join(', ')}\n`);
