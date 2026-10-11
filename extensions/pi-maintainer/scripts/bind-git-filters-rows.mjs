#!/usr/bin/env node
// Bind git filter/inventory rows closed by pm/git-filters.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const path = join(root, 'parity/ledger.json');
const ledger = JSON.parse(readFileSync(path, 'utf8'));

const gitSrc = ['src/git/feature.ts', 'src/git/policy.ts', 'src/git/options.ts', 'src/index.ts'];
const execPi = ['Host.exec'];

/** @type {Record<string, { pi: string[]; src: string[]; tests: string[] }>} */
const bindings = {
  'git.filter.gitignore': {
    pi: execPi,
    src: [...gitSrc, 'src/core/exchange.ts', 'src/edit/selection.ts'],
    tests: ['test/git/filters-bind.test.ts::isGitIgnored matches git check-ignore for paths rejected from inventory and edits', 'test/git/authorize-bind.test.ts::gitignored paths are skipped with the Aider skip warning'],
  },
  'git.filter.aiderignore': {
    pi: execPi,
    src: [...gitSrc],
    tests: ['test/git/filters-bind.test.ts::aiderignore excludes matching tracked paths and marks them policy-ignored', 'test/git/inventory-bind.test.ts::aiderignore excludes matching tracked paths from inventory'],
  },
  'git.filter.subtree': {
    pi: execPi,
    src: [...gitSrc],
    tests: ['test/git/filters-bind.test.ts::subtree-only inventory and isIgnored stay under the cwd tree'],
  },
  'git.inventory.addable-files': {
    pi: ['pi.registerCommand'],
    src: ['src/core/chat-files.ts', 'src/edit/commands.ts'],
    tests: ['test/git/filters-bind.test.ts::addable relative files are filtered inventory minus editable and read-only chat files'],
  },
  'git.inventory.no-repo-fallback': {
    pi: ['Host.exec'],
    src: ['src/core/chat-files.ts', 'src/git/policy.ts'],
    tests: ['test/git/filters-bind.test.ts::without a repository relative inventory is limited to in-chat editable files', 'test/core/context-bind.test.ts::inventory falls back to chat files without walking the workspace'],
  },
  'git.config.aiderignore-path': {
    pi: execPi,
    src: [...gitSrc],
    tests: ['test/git/filters-bind.test.ts::configured aiderignore path resolves relative to the git root and filters inventory'],
  },
  'git.commands.add-ignore-policy': {
    pi: ['pi.registerCommand', 'Host.exec'],
    src: ['src/edit/selection.ts', 'src/git/policy.ts', 'src/feature.ts'],
    tests: ['test/git/filters-bind.test.ts::add refuses gitignored paths and skips aiderignored paths with Aider warnings'],
  },
};

const updated = [];
for (const row of ledger.rows) {
  const binding = bindings[row.id];
  if (!binding) continue;
  row.status = 'verified';
  row.pi = binding.pi;
  row.src = binding.src;
  row.tests = binding.tests;
  updated.push(row.id);
}

writeFileSync(path, `${JSON.stringify(ledger, null, 2)}\n`);
process.stdout.write(`verified ${updated.length} rows\n${updated.join('\n')}\n`);
