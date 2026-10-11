#!/usr/bin/env node
// Fill pi/src/tests and mark verified for edit.watch.* rows with passing proof.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const path = join(root, 'parity/ledger.json');
const ledger = JSON.parse(readFileSync(path, 'utf8'));

const watchSrc = ['src/core/watch.ts'];
const watchPi = ["pi.on('session_start')", "pi.on('session_shutdown')"];

/** @type {Record<string, { pi: string[]; src: string[]; tests: string[] }>} */
const bindings = {
  'edit.watch.comments': {
    pi: watchPi,
    src: watchSrc,
    tests: ['test/core/watch-bind.test.ts::AI comment markers yield one-based lines and the last actionable bang or question'],
  },
  'edit.watch.filter': {
    pi: watchPi,
    src: watchSrc,
    tests: ['test/core/watch-bind.test.ts::built-in and gitignore patterns exclude editor noise and keep source files', 'test/core/watch-bind.test.ts::filter keeps under-root AI-comment files under one MiB and drops ignored paths'],
  },
  'edit.watch.roots': {
    pi: watchPi,
    src: watchSrc,
    tests: ['test/core/watch-bind.test.ts::watcher roots exclude ignored top-level entries and fall back to the root'],
  },
  'edit.watch.changes': {
    pi: watchPi,
    src: watchSrc,
    tests: ['test/core/watch-bind.test.ts::empty notifications leave state alone while nonempty paths interrupt input'],
  },
  'edit.watch.lifecycle': {
    pi: watchPi,
    src: watchSrc,
    tests: ['test/core/watch-bind.test.ts::starting clears pending changes and stop joins the monitor before discarding it'],
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
