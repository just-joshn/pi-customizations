#!/usr/bin/env node
// Fill pi/src/tests and mark verified for edit.ui.* rows whose listed tests already pass.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const path = join(root, 'parity/ledger.json');
const ledger = JSON.parse(readFileSync(path, 'utf8'));

/** @type {Record<string, { pi: string[]; src: string[]; tests: string[] }>} */
const bindings = {
  'edit.ui.chat-file-listing': {
    pi: ['host.output', 'context_with_system'],
    src: ['src/core/chat-file-listing.ts', 'src/core/exchange.ts'],
    tests: [
      'test/core/ui-chat-listing-bind.test.ts::plain mode lists read-only first with (read only) then editable paths',
      'test/core/ui-chat-listing-bind.test.ts::pretty mode with no files prints nothing',
      'test/core/ui-chat-listing-bind.test.ts::pretty mode editable-only columns omit the Editable label',
      'test/core/ui-chat-listing-bind.test.ts::pretty mode read-only-only columns use the Readonly label',
      'test/core/ui-chat-listing-bind.test.ts::pretty mode mixed files label Readonly then Editable',
      'test/core/ui-chat-listing-bind.test.ts::projectRequest emits the plain chat-file listing before the model prompt',
      'test/core/ui-chat-listing-bind.test.ts::projectRequest emits pretty Readonly and Editable columns when both kinds exist',
      'test/core/ui-chat-listing-bind.test.ts::projectRequest skips listing when the chat has no files',
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
