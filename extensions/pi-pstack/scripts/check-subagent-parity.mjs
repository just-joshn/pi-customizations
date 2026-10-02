#!/usr/bin/env node
// Parity gate for the Copilot subagent reconstruction. One row per contract in
// docs/subagents-parity.tsv. A row is closed only when its pointers resolve:
// every impl pointer names a file that exists, every test pointer names a test
// file that exists and, when it carries `::title`, contains that title.
// Exit 1 on a malformed row, a dangling pointer, or any row still `open`.
// `--allow-open` keeps the pointer checks and tolerates open rows.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const columns = ['id', 'contract', 'spec_pointer', 'status', 'impl_pointer', 'test_pointer', 'gap', 'pi_native_approach'];
const closed = new Set(['done-tested', 'unspecified', 'pi-na']);
const statuses = new Set(['open', ...closed]);
const argument = (name) => {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
};
const matrixPath = argument('--matrix') ?? join(packageRoot, 'docs/subagents-parity.tsv');
const root = argument('--root') ?? packageRoot;
const allowOpen = process.argv.includes('--allow-open');

const entries = (cell) => (cell === '-' || cell === '' ? [] : cell.split(' | '));
const pathOf = (entry) => entry.replace(/::.*$/, '').replace(/:\d+(?:-\d+)?$/, '');

function pointerProblems(record) {
  const problems = [];
  const impl = entries(record.impl_pointer);
  const tests = entries(record.test_pointer);
  if (impl.length === 0) problems.push('closed row names no impl pointer');
  if (tests.length === 0) problems.push('closed row names no test pointer');
  for (const entry of impl) if (!existsSync(join(root, pathOf(entry)))) problems.push(`impl pointer does not exist: ${entry}`);
  for (const entry of tests) {
    const file = join(root, pathOf(entry));
    if (!existsSync(file)) {
      problems.push(`test pointer does not exist: ${entry}`);
      continue;
    }
    const title = entry.includes('::') ? entry.slice(entry.indexOf('::') + 2) : undefined;
    if (title && !readFileSync(file, 'utf8').includes(title)) problems.push(`test title not found in ${pathOf(entry)}: ${title}`);
  }
  if (record.status !== 'done-tested' && (record.gap === '-' || record.gap === '')) problems.push(`${record.status} row must explain itself in gap`);
  return problems;
}

const [header, ...rows] = readFileSync(matrixPath, 'utf8').trimEnd().split('\n');
const problems = [];
if (header !== columns.join('\t')) problems.push(`header must be ${columns.join(' | ')}`);
const seen = new Set();
const counts = {};
const open = [];
for (const [index, row] of rows.entries()) {
  const cells = row.split('\t');
  if (cells.length !== columns.length) {
    problems.push(`line ${index + 2}: expected ${columns.length} columns, found ${cells.length}`);
    continue;
  }
  const record = Object.fromEntries(cells.map((cell, position) => [columns[position], cell]));
  if (seen.has(record.id)) problems.push(`${record.id}: duplicate id`);
  seen.add(record.id);
  if (!statuses.has(record.status)) {
    problems.push(`${record.id}: unknown status ${record.status}`);
    continue;
  }
  counts[record.status] = (counts[record.status] ?? 0) + 1;
  if (record.status === 'open') open.push(record);
  else for (const problem of pointerProblems(record)) problems.push(`${record.id}: ${problem}`);
}
for (const [status, count] of Object.entries(counts)) process.stdout.write(`${status}\t${count}\n`);
for (const record of open) process.stdout.write(`open\t${record.id}\t${record.contract.slice(0, 110)}\n`);
for (const problem of problems) process.stderr.write(`problem\t${problem}\n`);
process.exitCode = problems.length > 0 || (open.length > 0 && !allowOpen) ? 1 : 0;
