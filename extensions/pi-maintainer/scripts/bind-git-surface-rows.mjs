#!/usr/bin/env node
// Fill pi/src/tests and mark verified for git surface rows proven without owning src/git.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const path = join(root, 'parity/ledger.json');
const ledger = JSON.parse(readFileSync(path, 'utf8'));

/** @type {Record<string, { pi: string[]; src: string[]; tests: string[] }>} */
const bindings = {
  'git.mentions.add-and-reflect': {
    pi: ["pi.on('turn_end')", 'pi.registerVirtualModel'],
    src: ['src/core/mentions.ts', 'src/core/exchange.ts'],
    tests: [
      'test/core/git-surface-bind.test.ts::tracked reply mentions are offered one by one and approved adds reflect without applying edits',
      'test/core/mentions.pi.test.ts::assistant mentions reflect before applying the proposed edit',
    ],
  },
  'git.commands.add-refuses-outside-root': {
    pi: ['pi.registerCommand'],
    src: ['src/edit/selection.ts', 'src/edit/commands.ts'],
    tests: [
      'test/core/git-surface-bind.test.ts::add refuses a non-image path outside the root with Aider text when automatic commits are on',
      'test/edit/selection.test.ts::add refuses a non-image path outside the root when auto-commits are on',
    ],
  },
  'git.architect.return-editor-commits': {
    pi: ["pi.on('turn_end')", 'pi.appendEntry', 'pi.registerVirtualModel'],
    src: ['src/core/exchange.ts', 'src/core/branch.ts'],
    tests: ['test/core/git-surface-bind.test.ts::after the editor finishes, its assistant commit hashes are assigned back to the architect coder'],
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
