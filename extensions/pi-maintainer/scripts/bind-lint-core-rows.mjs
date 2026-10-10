#!/usr/bin/env node
// Fill pi/src/tests and mark verified for the first lint core cluster whose listed tests already pass.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const path = join(root, 'parity/ledger.json');
const ledger = JSON.parse(readFileSync(path, 'utf8'));

const pi = ["pi.on('turn_end')", 'Host.exec'];
const lintSrc = [
  'src/lint/feature.ts',
  'src/lint/options.ts',
  'src/lint/validation.ts',
  'src/lint/linter.ts',
  'src/lint/shell.ts',
  'src/core/exchange.ts',
  'src/index.ts',
];

/** @type {Record<string, { pi: string[]; src: string[]; tests: string[] }>} */
const bindings = {
  'lint.options.auto-lint-auto-test': {
    pi: ['pi.registerFlag'],
    src: ['src/lint/options.ts', 'src/lint/feature.ts', 'src/index.ts'],
    tests: [
      'test/lint/options-bind.test.ts::automatic lint defaults on and automatic tests default off',
      'test/lint/options-bind.test.ts::cli and config can disable auto-lint and enable auto-test',
    ],
  },
  'lint.followup.commit-before-validation': {
    pi,
    src: lintSrc,
    tests: ['test/lint/followup-bind.test.ts::edited files are auto-committed before lint runs'],
  },
  'lint.followup.order': {
    pi,
    src: lintSrc,
    tests: [
      'test/lint/followup-bind.test.ts::after edits, lint then shell then test follow when each is enabled',
      'test/lint/followup-bind.test.ts::auto-lint off skips lintEdited work and auto-test off skips testEdited work',
    ],
  },
  'lint.followup.reflect-failures': {
    pi,
    src: lintSrc,
    tests: [
      'test/core/lifecycle-bind.test.ts::a failed lint report reflects after confirmation',
      'test/lint/followup-bind.test.ts::a failed test report reflects after confirmation',
    ],
  },
};

const updated = [];
for (const row of ledger.rows) {
  const binding = bindings[row.id];
  if (!binding || row.status === 'verified') continue;
  row.status = 'verified';
  row.pi = binding.pi;
  row.src = binding.src;
  row.tests = binding.tests;
  updated.push(row.id);
}

writeFileSync(path, `${JSON.stringify(ledger, null, 2)}\n`);
process.stdout.write(`verified ${updated.length} rows\n${updated.join('\n')}\n`);
