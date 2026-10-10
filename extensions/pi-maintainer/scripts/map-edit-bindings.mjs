#!/usr/bin/env node
// Map Vitest titles and meta.aider / meta.evidence tags to edit ledger rows via coverage.json.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolvePackage();
const coverage = readJson('parity/coverage.json');
const ledger = readJson('parity/ledger.json');

function resolvePackage() {
  return fileURLToPath(new URL('..', import.meta.url));
}

function readJson(path) {
  return JSON.parse(readFileSync(join(root, path), 'utf8'));
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (name.endsWith('.ts') && !name.endsWith('.d.ts')) out.push(path);
  }
  return out;
}

function parseArray(block, key) {
  const match = block.match(new RegExp(`${key}:\\s*(\\[[^\\]]*\\])`));
  if (!match) return [];
  try {
    return JSON.parse(match[1].replace(/'/g, '"'));
  } catch {
    return [];
  }
}

const tagged = [];
for (const file of walk(join(root, 'test'))) {
  if (file.includes(`${join('test', 'parity')}`)) continue;
  const text = readFileSync(file, 'utf8');
  const rx = /test\(\s*(['"`])((?:\\.|(?!\1).)*)\1\s*,\s*\{/g;
  let match;
  while ((match = rx.exec(text))) {
    const title = match[2];
    const optionsStart = match.index + match[0].length - 1;
    const block = balanced(text, optionsStart);
    if (!block.includes('meta:')) continue;
    tagged.push({
      selector: `${relative(root, file)}::${title}`,
      aider: parseArray(block, 'aider'),
      evidence: parseArray(block, 'evidence'),
    });
  }
}

function balanced(text, openIndex) {
  let depth = 0;
  for (let i = openIndex; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '{' || ch === '[') depth += 1;
    else if (ch === '}' || ch === ']') {
      depth -= 1;
      if (depth === 0) return text.slice(openIndex, i + 1);
    }
  }
  return '';
}

const unitRows = new Map();
for (const [unit, entry] of Object.entries(coverage)) {
  for (const row of entry.rows ?? []) {
    if (!unitRows.has(unit)) unitRows.set(unit, new Set());
    unitRows.get(unit).add(row);
  }
}

const byRow = new Map();
for (const entry of tagged) {
  const units = [...entry.aider.map((id) => `aider-test/${id}`), ...entry.evidence];
  for (const unit of units) {
    for (const row of unitRows.get(unit) ?? []) {
      if (!byRow.has(row)) byRow.set(row, []);
      byRow.get(row).push({ selector: entry.selector, unit });
    }
  }
}

const focus = process.argv.slice(2);
const rows = ledger.rows.filter((row) => row.feature === 'edit' && (!focus.length || focus.some((prefix) => row.id.startsWith(prefix) || row.id === prefix)));

for (const row of rows) {
  const tagUnits = [...unitRows.entries()].filter(([, mapped]) => mapped.has(row.id)).map(([unit]) => unit).filter((unit) => unit.startsWith('aider-test/') || unit.startsWith('ev-'));
  const candidates = byRow.get(row.id) ?? [];
  const covered = new Set(candidates.map((entry) => entry.unit));
  const missing = tagUnits.filter((unit) => !covered.has(unit));
  const selectors = [...new Set(candidates.map((entry) => entry.selector))];
  process.stdout.write(`${row.id}\t${row.status}\tpi=${row.pi.length}\tsrc=${row.src.length}\ttests=${row.tests.length}\ttagUnits=${tagUnits.length}\tmissing=${missing.length}\n`);
  for (const selector of selectors) process.stdout.write(`  candidate\t${selector}\n`);
  for (const unit of missing) process.stdout.write(`  missing\t${unit}\n`);
}
