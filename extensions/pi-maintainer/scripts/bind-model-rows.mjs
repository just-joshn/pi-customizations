#!/usr/bin/env node
// Fill pi/src/tests and mark verified for edit.model.format-policy.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const path = join(root, 'parity/ledger.json');
const ledger = JSON.parse(readFileSync(path, 'utf8'));

/** @type {Record<string, { pi: string[]; src: string[]; tests: string[] }>} */
const bindings = {
  'edit.model.format-policy': {
    pi: ["pi.on('session_start')", 'ctx.model (physical model id for policy resolution)'],
    src: ['src/edit/model-format-policy.ts', 'src/edit/model-format-settings.json', 'src/core/install.ts'],
    tests: [
      'test/edit/model-format-policy-bind.test.ts::unrecognized model names default to whole-file editing',
      'test/edit/model-format-policy-bind.test.ts::packaged gpt-3.5-turbo keeps whole format and sys reminder',
      'test/edit/model-format-policy-bind.test.ts::packaged gpt-4o selects diff, editor-diff, examples, and sys reminder',
      'test/edit/model-format-policy-bind.test.ts::generic name heuristics select documented format fields',
      'test/edit/model-format-policy-bind.test.ts::selectEditFormat uses the model policy as modelDefault when request is unset',
      'test/edit/model-format-policy-bind.test.ts::explicit edit format outranks the model default',
      'test/edit/model-format-policy-bind.test.ts::prompt and editor policy map from the resolved model format',
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
