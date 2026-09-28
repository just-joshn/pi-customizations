#!/usr/bin/env node
// Normalizes a `make verify` log into a stable fact list so the pre-migration
// and post-migration runs can be diffed instead of eyeballed. Suites are
// matched in the order `make verify` runs them, so both runners' output
// shapes (bare npm, or bun's `--filter` prefix) parse the same way.
import { readFileSync } from 'node:fs';

const log = readFileSync(process.argv[2], 'utf8');

const once = (label, pattern) => {
  const found = log.match(pattern);
  if (!found) throw new Error(`missing ${label}`);
  return found.slice(1).join('|');
};

const optional = (pattern) => {
  const found = log.match(pattern);
  return found ? found[1] : 'absent (gate did not exist)';
};

const all = (pattern) => [...log.matchAll(pattern)];

const SUITES = ['pstack', 'anthropic', 'antigravity', 'tui-parity', 'one-dark-pro'];
// Only three of the five suites run a coverage gate under `make verify`.
const COVERED = ['pstack', 'tui-parity', 'one-dark-pro'];

const summaryPattern =
  /Statements\s+:\s+([\d.]+)%\s+\(\s*(\d+)\/(\d+)\s*\)[\s\S]{0,140}?Branches\s+:\s+([\d.]+)%\s+\(\s*(\d+)\/(\d+)\s*\)[\s\S]{0,140}?Functions\s+:\s+([\d.]+)%\s+\(\s*(\d+)\/(\d+)\s*\)[\s\S]{0,140}?Lines\s+:\s+([\d.]+)%\s+\(\s*(\d+)\/(\d+)\s*\)/g;
const suiteCoverage = all(summaryPattern);
if (suiteCoverage.length !== COVERED.length) {
  throw new Error(`expected ${COVERED.length} coverage summaries, found ${suiteCoverage.length}`);
}

const testPattern = /Test Files\s+(\d+) passed \(\d+\)[\s\S]{0,140}?Tests\s+(\d+) passed \(\d+\)/g;
const suiteTests = all(testPattern);
if (suiteTests.length !== SUITES.length) {
  throw new Error(`expected ${SUITES.length} test summaries, found ${suiteTests.length}`);
}

const pythonRuns = all(/Ran (\d+) tests? in/g).map((match) => Number(match[1]));
if (pythonRuns.length !== 3) throw new Error(`expected 3 python runs, found ${pythonRuns.length}`);

const coverageRow = (_name, index) => {
  const row = suiteCoverage[index];
  return {
    statements: Number(row[1]),
    branches: Number(row[4]),
    functions: Number(row[7]),
    lines: Number(row[10]),
  };
};

const facts = {
  'toolchain: lockfile/files/foreign managers': optional(/Bun toolchain: (\d+ lockfile, \d+ files, \d+ foreign package managers)\./),
  'mechanisms: packages/extensions/skills/prompts/themes': once('mechanisms', /Checked (\d+ packages: \d+ extensions, \d+ skills, \d+ prompt templates, \d+ themes)\./),
  'vitest-conventions: scanned/violations/review': once('conventions', /(\d+ vitest files scanned\. \d+ violations, \d+ review items)\./),
  'pstack: resources': once('resources', /(Verified \d+ upstream files and \d+ generated resources)\./),
  'pstack: journeys': once('journeys', /(\d+ checks passed, \d+ findings)/),
};

SUITES.forEach((name, index) => {
  facts[`${name}: tests`] = `${Number(suiteTests[index][1])} files / ${Number(suiteTests[index][2])} tests`;
});
COVERED.forEach((name, index) => {
  facts[`${name}: coverage stmt/branch/func/line`] = coverageRow(name, index);
});

facts['fresh-install: anthropic models'] = Number(once('anthropic models', /pi-anthropic-oauth: (\d+) claude-subscription models from a fresh copy/));
facts['fresh-install: antigravity models'] = Number(once('antigravity models', /pi-antigravity-oauth: (\d+) google-antigravity models from a fresh copy/));
facts['fresh-install: root skills'] = Number(once('root skills', /repository root: (\d+) skills from a fresh copy/));
facts['fresh-install: cli verify'] = /Verified installed Pi CLI package loading, RPC commands, status, mode off, and orderly shutdown without model calls\./.test(log);
facts['python: tests run'] = pythonRuns.reduce((total, count) => total + count, 0);
facts['python: coverage'] = once('python coverage', /TOTAL\s+\d+\s+\d+\s+\d+\s+\d+\s+(\d+%)/);

for (const [key, value] of Object.entries(facts)) {
  process.stdout.write(`${key}\t${typeof value === 'object' ? JSON.stringify(value) : value}\n`);
}
