#!/usr/bin/env node
// Fill pi/src/tests and mark verified for edit.input.* rows with passing proof.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const path = join(root, 'parity/ledger.json');
const ledger = JSON.parse(readFileSync(path, 'utf8'));

const inputSrc = ['src/edit/startup-input.ts', 'src/core/install.ts', 'src/edit/options.ts', 'src/edit/feature.ts'];
const inputPi = ['pi.registerFlag', "pi.on('session_start')", 'pi.getFlag', 'pi.sendUserMessage'];

/** @type {Record<string, { pi: string[]; src: string[]; tests: string[] }>} */
const bindings = {
  'edit.input.empty-selection': {
    pi: ['pi.registerFlag', "pi.on('session_start')", 'pi.getFlag'],
    src: inputSrc,
    tests: ['test/edit/input-bind.test.ts::an empty startup file list yields an empty editable selection'],
  },
  'edit.input.initial-files': {
    pi: ['pi.registerFlag', "pi.on('session_start')", 'pi.getFlag'],
    src: inputSrc,
    tests: ['test/edit/input-bind.test.ts::missing editable files are created and selected', 'test/edit/input-bind.test.ts::paths that cannot be created or are not ordinary files are diagnosed and excluded'],
  },
  'edit.input.message-file': {
    pi: inputPi,
    src: inputSrc,
    tests: ['test/edit/input-bind.test.ts::a message file is read with the configured encoding and enters the request path', 'test/edit/input-bind.test.ts::a missing message file is reported and does not enter the request path'],
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
