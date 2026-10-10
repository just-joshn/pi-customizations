#!/usr/bin/env node
// Bind edit.install.complete-runtime after the isolated pack proof passes.
// edit.prompt.context-limit-confirm stays open (NATIVE-GAP).
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const path = join(root, 'parity/ledger.json');
const ledger = JSON.parse(readFileSync(path, 'utf8'));

/** @type {Record<string, { pi: string[]; src: string[]; tests: string[] }>} */
const bindings = {
  'edit.install.complete-runtime': {
    pi: ['Pi package'],
    src: ['src/index.ts', 'src/edit/feature.ts', 'src/edit/model-format-policy.ts', 'src/edit/model-format-settings.json', 'package.json'],
    tests: ['test/edit/install-complete-runtime.test.ts::isolated package load registers every edit format and packaged resources'],
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
