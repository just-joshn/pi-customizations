#!/usr/bin/env node
// Fill pi/src/tests and mark verified for edit.dry-run.* rows with passing proof.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const path = join(root, 'parity/ledger.json');
const ledger = JSON.parse(readFileSync(path, 'utf8'));

/** @type {Record<string, { pi: string[]; src: string[]; tests: string[] }>} */
const bindings = {
  'edit.dry-run.report-new-file': {
    pi: ["pi.on('turn_end')"],
    src: ['src/edit/working-tree.ts', 'src/core/exchange.ts', 'src/edit/editblock.ts'],
    tests: [
      'test/edit/dry-run-bind.test.ts::dry-run empty-SEARCH new file reports Did not apply without writing or reflecting',
      'test/working-tree-dry-run.test.ts::dry-run touch leaves missing directories absent',
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
