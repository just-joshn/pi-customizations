#!/usr/bin/env node
// Fill pi/src/tests and mark verified for edit.io.* rows whose listed tests already pass.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const path = join(root, 'parity/ledger.json');
const ledger = JSON.parse(readFileSync(path, 'utf8'));

/** @type {Record<string, { pi: string[]; src: string[]; tests: string[] }>} */
const bindings = {
  'edit.io.line-endings-option': {
    pi: ['WorkingTree.write'],
    src: ['src/edit/working-tree.ts', 'src/edit/feature.ts', 'src/edit/options.ts'],
    tests: [
      'test/edit/io-line-endings-bind.test.ts::settings line-endings=lf writes that newline through the edit working tree',
      'test/edit/io-line-endings-bind.test.ts::settings line-endings=crlf writes that newline through the edit working tree',
      'test/edit/io-line-endings-bind.test.ts::settings line-endings=platform writes that newline through the edit working tree',
      'test/edit/io-line-endings-bind.test.ts::invalid line-endings fails with Aider Invalid line_endings value message',
      'test/working-tree.test.ts::writes configured LF line endings',
      'test/working-tree.test.ts::writes configured CRLF line endings',
      'test/working-tree.test.ts::writes configured platform line endings',
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
