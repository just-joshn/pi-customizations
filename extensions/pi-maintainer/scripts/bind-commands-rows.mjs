#!/usr/bin/env node
// Fill pi/src/tests and mark verified for edit.commands rows with passing proof.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const path = join(root, 'parity/ledger.json');
const ledger = JSON.parse(readFileSync(path, 'utf8'));

const pi = ['pi.registerCommand', "pi.on('agent_settled')", 'pi.sendUserMessage', 'pi.appendEntry'];
const src = ['src/edit/commands.ts', 'src/edit/selection.ts', 'src/core/install.ts', 'src/core/command.ts'];

const bindings = {
  'edit.commands.argument-completions': {
    pi: ['pi.registerCommand'],
    src: ['src/edit/commands.ts', 'src/core/install.ts'],
    tests: ['test/edit/commands-complete.test.ts::add argument completions list tracked files that are not already in chat'],
  },
  'edit.commands.add-literal': {
    pi,
    src,
    tests: [
      'test/edit/selection.test.ts::add accepts literal relative and absolute files',
      'test/edit/selection.test.ts::add expands a quoted filename with spaces',
      'test/core/commands.pi.test.ts::/add registers an editable file through pi.registerCommand',
    ],
  },
  'edit.commands.add-glob': {
    pi,
    src,
    tests: [
      'test/edit/selection.test.ts::add expands a directory glob under the root',
      'test/edit/selection.test.ts::add refuses wildcard creation when nothing matches',
    ],
  },
  'edit.commands.create-unmatched': {
    pi,
    src,
    tests: [
      'test/edit/selection.test.ts::add creates an unmatched non-wildcard path after confirmation',
      'test/edit/selection.test.ts::add refuses wildcard creation when nothing matches',
    ],
  },
  'edit.commands.add-root-policy': {
    pi,
    src,
    tests: ['test/edit/selection.test.ts::add refuses a non-image path outside the root when auto-commits are on'],
  },
  'edit.commands.drop-matches': {
    pi,
    src,
    tests: ['test/edit/selection.test.ts::drop removes matching editable and read-only paths'],
  },
  'edit.commands.drop-all': {
    pi,
    src,
    tests: [
      'test/edit/selection.test.ts::bare drop keeps originally supplied read-only files',
      'test/core/commands.pi.test.ts::/drop clears editable files while keeping original read-only files',
    ],
  },
  'edit.commands.reset': {
    pi,
    src,
    tests: ['test/core/commands.pi.test.ts::/reset drops files and advances historyThrough'],
  },
  'edit.commands.read-only-paths': {
    pi,
    src,
    tests: ['test/edit/selection.test.ts::read-only accepts a literal external path'],
  },
  'edit.commands.read-only-conversion': {
    pi,
    src,
    tests: ['test/edit/selection.test.ts::read-only converts editable files when bare'],
  },
  'edit.commands.read-only-images': {
    pi,
    src,
    tests: ['test/edit/selection.test.ts::read-only refuses images when vision is unsupported'],
  },
  'edit.commands.save-selection': {
    pi,
    src,
    tests: [
      'test/edit/selection.test.ts::save writes reconstruction commands with relative and absolute paths',
      'test/core/commands.pi.test.ts::/save and /load reconstruct editable and read-only selections',
    ],
  },
  'edit.commands.load-selection': {
    pi,
    src,
    tests: [
      'test/core/commands.pi.test.ts::/save and /load reconstruct editable and read-only selections',
      'test/core/commands.pi.test.ts::/load skips interactive mode-switch commands and continues',
    ],
  },
  'edit.commands.one-shot-ask': {
    pi,
    src,
    tests: ['test/core/commands.pi.test.ts::/ask with text runs one no-edit exchange then returns to the prior mode'],
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
