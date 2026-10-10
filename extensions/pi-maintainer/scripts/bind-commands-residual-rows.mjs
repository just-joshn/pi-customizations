#!/usr/bin/env node
// Fill pi/src/tests and mark verified for residual edit.commands rows.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const path = join(root, 'parity/ledger.json');
const ledger = JSON.parse(readFileSync(path, 'utf8'));

const pi = ['pi.registerCommand', 'pi.appendEntry', 'ctx.modelRegistry'];
const src = [
  'src/edit/commands.ts',
  'src/edit/file-token-listing.ts',
  'src/edit/model-switch.ts',
  'src/edit/packaged-default-format.ts',
  'src/core/branch.ts',
  'src/core/command.ts',
  'src/core/install.ts',
];

const bindings = {
  'edit.commands.file-token-listing': {
    pi: ['pi.registerCommand', 'estimateTokens'],
    src: ['src/edit/commands.ts', 'src/edit/file-token-listing.ts'],
    tests: [
      'test/edit/commands-residual.test.ts::context-usage file rows list editable and read-only names with estimates and a drop hint',
      'test/edit/commands-residual.test.ts::/tokens lists selected editable and read-only files with estimates and a drop hint',
    ],
  },
  'edit.commands.model-format-switch': {
    pi,
    src,
    tests: [
      'test/edit/commands-residual.test.ts::/model adopts the new packaged default and keeps editor and weak selections',
      'test/edit/commands-residual.test.ts::/model preserves an explicit edit format across the main model switch',
      'test/core/commands.pi.test.ts::/model and /editor-model persist role selections for the next reconstruction',
    ],
  },
  'edit.commands.editor-model-switch': {
    pi,
    src,
    tests: [
      'test/edit/commands-residual.test.ts::/editor-model preserves main and weak selections on the snapshot',
      'test/core/commands.pi.test.ts::/model and /editor-model persist role selections for the next reconstruction',
    ],
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
