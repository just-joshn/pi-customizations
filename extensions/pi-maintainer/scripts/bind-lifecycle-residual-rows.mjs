#!/usr/bin/env node
// Fill pi/src/tests and mark verified for residual edit.lifecycle stream-entry and undo-port rows.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const path = join(root, 'parity/ledger.json');
const ledger = JSON.parse(readFileSync(path, 'utf8'));

const bindings = {
  'edit.lifecycle.stream-entry': {
    pi: ['pi.registerVirtualModel'],
    src: ['src/core/route-entry.ts', 'src/core/install.ts'],
    tests: ['test/core/lifecycle-residual.test.ts::direct route entry skips exchange binding and mention preprocessing', 'test/core/lifecycle-residual.test.ts::an unbound idle exchange refuses automatic reflection follow-ups'],
  },
  'edit.lifecycle.undo-port': {
    pi: ['pi.registerCommand'],
    src: ['src/feature.ts', 'src/edit/commands.ts', 'src/core/command.ts'],
    tests: ['test/core/lifecycle-residual.test.ts::/undo dispatches to the git port and surfaces a disabled refusal', 'test/core/lifecycle-residual.test.ts::/undo surfaces a restoration result from the git port without edit-layer restore'],
  },
};

const updated = [];
for (const row of ledger.rows) {
  const binding = bindings[row.id];
  if (!binding) continue;
  row.pi = binding.pi;
  row.src = binding.src;
  row.tests = binding.tests;
  row.status = 'verified';
  updated.push(row.id);
}

writeFileSync(path, `${JSON.stringify(ledger, null, 2)}\n`);
process.stdout.write(`verified ${updated.length} rows\n${updated.join('\n')}\n`);
