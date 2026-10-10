#!/usr/bin/env node
// Fill pi/src/tests and mark verified for the lint dispatch/linter cluster whose listed tests already pass.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const path = join(root, 'parity/ledger.json');
const ledger = JSON.parse(readFileSync(path, 'utf8'));

const pi = ['Host.exec'];
const lintSrc = [
  'src/lint/linter.ts',
  'src/lint/parse-lint-cmds.ts',
  'src/lint/shell.ts',
  'src/lint/options.ts',
  'src/lint/feature.ts',
];

/** @type {Record<string, { pi: string[]; src: string[]; tests: string[] }>} */
const bindings = {
  'lint.options.lint-cmd-mapping': {
    pi: ['pi.registerFlag'],
    src: ['src/lint/parse-lint-cmds.ts', 'src/lint/options.ts', 'src/lint/feature.ts'],
    tests: [
      'test/lint/dispatch-bind.test.ts::parse_lint_cmds maps language prefixes, unprefixed None, strips, and last key wins',
    ],
  },
  'lint.dispatch.precedence': {
    pi,
    src: lintSrc,
    tests: [
      'test/lint/dispatch-bind.test.ts::without explicit override, filename recognition precedes the global command',
      'test/lint/dispatch-bind.test.ts::language-specific command is used when no global command is configured',
    ],
  },
  'lint.dispatch.unknown-skip': {
    pi,
    src: ['src/lint/linter.ts'],
    tests: [
      'test/lint/dispatch-bind.test.ts::unknown extensions produce no lint report under automatic and global-command dispatch',
    ],
  },
  'lint.custom.append-relpath': {
    pi,
    src: ['src/lint/linter.ts', 'src/lint/shell.ts'],
    tests: [
      'test/lint/dispatch-bind.test.ts::custom lint appends one oslex-quoted relative path and discards exit-zero output',
      'test/lint/dispatch-bind.test.ts::nonzero custom lint output becomes diagnostic context with extracted lines',
    ],
  },
  'lint.diagnostics.line-extraction': {
    pi: [],
    src: ['src/lint/linter.ts'],
    tests: [
      'test/lint/dispatch-bind.test.ts::find_filenames_and_linenums extracts one-based line sets with word-boundary filename matches',
    ],
  },
  'lint.fail.explicit-unknown-command': {
    pi,
    src: ['src/lint/linter.ts', 'src/lint/shell.ts'],
    tests: [
      'test/lint/dispatch-bind.test.ts::explicit lint command bypasses unknown-file skipping and can still fail',
    ],
  },
  'lint.docs.lint-flag-typo': {
    pi: ['pi.registerFlag'],
    src: ['src/lint/options.ts', 'docs/usage/lint-test.md'],
    tests: [
      'test/lint/dispatch-bind.test.ts::--lint is a boolean one-shot flag and language checkers use --lint-cmd',
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
