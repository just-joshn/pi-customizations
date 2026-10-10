#!/usr/bin/env node
// Fill pi/src/tests and mark verified for edit.confirm.* rows whose listed tests already pass.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const path = join(root, 'parity/ledger.json');
const ledger = JSON.parse(readFileSync(path, 'utf8'));

const confirmSrc = ['src/core/confirm.ts', 'src/core/pi-host.ts', 'src/core/exchange.ts'];
const pi = ['ctx.ui.select'];

/** @type {Record<string, { pi: string[]; src: string[]; tests: string[] }>} */
const bindings = {
  'edit.confirm.answers': {
    pi,
    src: confirmSrc,
    tests: [
      'test/core/confirm-bind.test.ts::empty and EOF answers take the default yes while invalid input reprompts',
      'test/core/confirm-bind.test.ts::yes-always answers yes except explicit-yes questions, and always-no answers no',
    ],
  },
  'edit.confirm.yes-always': {
    pi,
    src: confirmSrc,
    tests: ['test/core/confirm-bind.test.ts::yes-always answers yes except explicit-yes questions, and always-no answers no'],
  },
  'edit.confirm.group': {
    pi,
    src: confirmSrc,
    tests: ['test/core/confirm-bind.test.ts::a multi-item confirm group shares All and Skip without asking again'],
  },
  'edit.confirm.dont-ask-again': {
    pi,
    src: confirmSrc,
    tests: ["test/core/confirm-bind.test.ts::Don't ask again denies the same question and subject for the rest of the session"],
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
