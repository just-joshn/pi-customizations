#!/usr/bin/env node
// Fill pi/src/tests and mark verified for lint commands/shell/test rows whose listed tests already pass.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const path = join(root, 'parity/ledger.json');
const ledger = JSON.parse(readFileSync(path, 'utf8'));

const pi = ['pi.registerCommand', 'Host.exec', 'pi.sendUserMessage'];
const lintSrc = [
  'src/lint/commands.ts',
  'src/lint/feature.ts',
  'src/lint/validation.ts',
  'src/lint/shell.ts',
  'src/lint/select-files.ts',
  'src/lint/run-output.ts',
  'src/core/command.ts',
  'src/core/install.ts',
];

/** @type {Record<string, { pi: string[]; src: string[]; tests: string[] }>} */
const bindings = {
  'lint.test.command-output': {
    pi,
    src: lintSrc,
    tests: [
      'test/lint/commands-bind.test.ts::/test runs the configured command and on failure adds repair output to chat',
    ],
  },
  'lint.shell.approve-and-run': {
    pi: ['Host.exec', 'Host.confirm'],
    src: ['src/lint/validation.ts', 'src/lint/shell.ts', 'src/core/confirm.ts'],
    tests: [
      'test/lint/commands-bind.test.ts::runSuggestedShell confirms each block, skips comments, and offers add-output-to-chat',
    ],
  },
  'lint.test.no-command-noop': {
    pi: ['pi.registerCommand'],
    src: ['src/lint/commands.ts', 'src/lint/feature.ts'],
    tests: [
      'test/lint/commands-bind.test.ts::/test with neither argument nor configured command is a silent noop',
    ],
  },
  'lint.commands.lint-file-selection': {
    pi,
    src: ['src/lint/commands.ts', 'src/lint/select-files.ts', 'src/lint/feature.ts', 'src/core/install.ts'],
    tests: [
      'test/lint/commands-bind.test.ts::selectLintRelativeFiles prefers explicit filenames, then chat files, then dirty files',
      'test/lint/commands-bind.test.ts::/lint requires a repository and lints dirty files when chat is empty',
      'test/lint/commands-bind.test.ts::/lint uses explicit filenames before chat files',
    ],
  },
  'lint.security.shell-trust': {
    pi: ['Host.exec'],
    src: ['src/lint/shell.ts', 'src/lint/validation.ts', 'docs/NATIVE-GAPS.md'],
    tests: [
      'test/lint/security-bind.test.ts::Host.exec /bin/sh -c runs trusted shell under the user account; filename quoting does not sandbox compounds',
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
