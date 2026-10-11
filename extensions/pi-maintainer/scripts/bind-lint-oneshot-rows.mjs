#!/usr/bin/env node
// Fill pi/src/tests and mark verified for the lint oneshot/fail cluster whose listed tests already pass.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const path = join(root, 'parity/ledger.json');
const ledger = JSON.parse(readFileSync(path, 'utf8'));

const pi = ['pi.registerFlag', "pi.on('session_start')", 'Host.exec'];
const oneshotSrc = ['src/lint/oneshot.ts', 'src/lint/options.ts', 'src/lint/commands.ts', 'src/lint/feature.ts', 'src/core/install.ts'];
const failSrc = ['src/lint/linter.ts', 'src/lint/validation.ts', 'src/lint/feature.ts'];

/** @type {Record<string, { pi: string[]; src: string[]; tests: string[] }>} */
const bindings = {
  'lint.options.oneshot-flags': {
    pi,
    src: oneshotSrc,
    tests: [
      'test/lint/oneshot-bind.test.ts::--lint and --test are boolean oneshot startup flags; --test-cmd remains the command string',
      'test/lint/oneshot-bind.test.ts::startup --test without --test-cmd exits 1 before running tests',
      'test/lint/oneshot-bind.test.ts::startup --lint runs the lint workflow then exits 0 before optional commit',
    ],
  },
  'lint.oneshot.test-exit': {
    pi,
    src: oneshotSrc,
    tests: ['test/lint/oneshot-bind.test.ts::startup --test ignores repair feedback for model fixing unless placeholder is set; child failure is not process exit status'],
  },
  'lint.fail.ambiguous-pass': {
    pi: ['Host.exec'],
    src: failSrc,
    tests: ['test/lint/oneshot-bind.test.ts::lint and test CheckOutcome kinds distinguish clean, unsupported, unreadable, unavailable, and missing command'],
  },
  'lint.fail.root-none-path': {
    pi: ['Host.exec'],
    src: ['src/lint/linter.ts'],
    tests: ['test/lint/oneshot-bind.test.ts::relativeLintName with null root preserves the incoming path object (Aider get_rel_fname quirk)'],
  },
  'lint.fail.stale-diagnostics': {
    pi: ['Host.exec'],
    src: ['src/lint/linter.ts'],
    tests: ['test/lint/oneshot-bind.test.ts::custom lint command that rewrites the file leaves repair markers on initially read bytes'],
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
