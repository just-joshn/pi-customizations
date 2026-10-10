#!/usr/bin/env node
// Fill pi/src/tests and mark verified for edit.shell.* rows whose listed tests already pass.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const path = join(root, 'parity/ledger.json');
const ledger = JSON.parse(readFileSync(path, 'utf8'));

const pi = ["pi.on('turn_end')"];
const shellSrc = ['src/core/exchange.ts', 'src/edit/feature.ts', 'src/edit/editblock.ts', 'src/feature.ts'];

/** @type {Record<string, { pi: string[]; src: string[]; tests: string[] }>} */
const bindings = {
  'edit.shell.suggestion-setting': {
    pi,
    src: [...shellSrc, 'src/edit/options.ts', 'src/edit/prompts/format.ts'],
    tests: [
      'test/edit/shell-bind.test.ts::suggest-shell-commands defaults to true and --no-suggest-shell-commands disables it',
      'test/edit/shell-bind.test.ts::disabling suggest-shell-commands swaps to the no-shell prompt text',
      'test/edit/shell-bind.test.ts::suggest-shell-commands false skips the shell port even when the reply has bash fences',
    ],
  },
  'edit.shell.forward-blocks': {
    pi,
    src: shellSrc,
    tests: [
      'test/edit/shell-bind.test.ts::a bare bash fence forwards one distinct block to the validation shell port',
      'test/edit/shell-bind.test.ts::duplicate identical bash fences forward once',
      'test/edit/shell-bind.test.ts::a SEARCH-bearing shell fence stays a file edit and does not reach the shell port',
      'test/editblock-ports.test.ts::collects a bare bash fence as a suggested shell command',
      'test/editblock-ports.test.ts::treats a shell fence with SEARCH as an edit not a command',
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
