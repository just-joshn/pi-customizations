#!/usr/bin/env node
/**
 * Compare a live pi-cursor-ui capture against the stored cursor-agent reference.
 *
 * The reference under reference/ was captured from the installed cursor-agent
 * build with `tmux capture-pane`. This script checks the elements the skin
 * claims to reproduce, so a regression shows up as a named failure rather than a
 * diff a reviewer has to eyeball.
 *
 *   node scripts/compare-reference.mjs [capture.txt]
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REFERENCE = join(PKG_ROOT, 'reference/cursor-agent-2026.09.28-idle-110x34.txt');
const CANDIDATE = process.argv[2] ?? join(PKG_ROOT, 'artifacts/idle/01-idle.txt');

const rows = (path) =>
  readFileSync(path, 'utf8')
    .replace(/\n+$/, '')
    .split('\n')
    .map((line) => line.trimEnd());
const reference = rows(REFERENCE);
const candidate = rows(CANDIDATE);

const referenceBandTop = reference.find((line) => /^ ▄{8,}/.test(line)) ?? '';
const referenceBandBottom = reference.find((line) => /^ ▀{8,}/.test(line)) ?? '';
const referenceInputRow = reference.find((line) => line.startsWith('  → ')) ?? '';

const checks = [
  ['band top is a ▄ run with a 1-column left margin', () => candidate.some((line) => /^ ▄{8,}/.test(line))],
  ['band bottom is a ▀ run with a 1-column left margin', () => candidate.some((line) => /^ ▀{8,}/.test(line))],
  ['bands carry the same glyph as the reference', () => referenceBandTop.startsWith(' ▄') && referenceBandBottom.startsWith(' ▀')],
  ['input row is `  → <placeholder>`', () => candidate.some((line) => /^ {2}→ \S/.test(line))],
  ['idle placeholder text matches the reference', () => referenceInputRow.includes('Plan, search, build anything') && candidate.some((line) => line.includes('Plan, search, build anything'))],
  ['a footer mode line carries `(shift+tab to cycle)`', () => candidate.some((line) => /^ {2}\S.* \(shift\+tab to cycle\)/.test(line))],
  ['the footer is three rows with a 2-column indent', () => candidate.filter((line) => line.startsWith('  ') && line.trim() !== '').length >= 3],
  ['nothing in the footer is right-aligned', () => candidate.slice(-3).every((line) => line === line.trimEnd())],
];

let failures = 0;
for (const [name, check] of checks) {
  const ok = check();
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`);
}
console.log(`\nreference: ${REFERENCE}`);
console.log(`candidate: ${CANDIDATE}`);
console.log(`failures: ${failures}`);
process.exitCode = failures === 0 ? 0 : 1;
