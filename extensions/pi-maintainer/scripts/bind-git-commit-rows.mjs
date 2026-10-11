#!/usr/bin/env node
// Bind commit/dirty/dry-run/hooks/config rows closed by pm/git-commit.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const path = join(root, 'parity/ledger.json');
const ledger = JSON.parse(readFileSync(path, 'utf8'));

const gitSrc = ['src/git/feature.ts', 'src/git/policy.ts', 'src/git/options.ts', 'src/index.ts'];
const execPi = ['Host.exec'];
const exchangeSrc = [...gitSrc, 'src/core/exchange.ts'];

/** @type {Record<string, { pi: string[]; src: string[]; tests: string[] }>} */
const bindings = {
  'git.dirty.path-semantics': {
    pi: execPi,
    src: [...gitSrc, 'src/git/cli.ts'],
    tests: ['test/git/commit-wave-bind.test.ts::pathless isDirty ignores untracked files while a missing inventory path is dirty'],
  },
  'git.commit.auto-after-edit': {
    pi: execPi,
    src: exchangeSrc,
    tests: ['test/git/commit-wave-bind.test.ts::after applying edits the exchange auto-commits written files before lint follow-up'],
  },
  'git.commit.noop-when-clean': {
    pi: execPi,
    src: [...gitSrc, 'src/git/cli.ts'],
    tests: ['test/git/commit-wave-bind.test.ts::autoCommit is a noop without a model call when the selection is empty or the diff is empty'],
  },
  'git.commit.verify-flag': {
    pi: execPi,
    src: [...gitSrc, 'src/git/cli.ts'],
    tests: ['test/git/commit-wave-bind.test.ts::git-commit-verify off passes --no-verify so a failing pre-commit hook does not block'],
  },
  'git.commit.attribution': {
    pi: execPi,
    src: [...gitSrc, 'src/branding.ts', 'src/git/cli.ts'],
    tests: ['test/git/commit-wave-bind.test.ts::assistant commits apply co-authored-by and optional name attribution from CLI defaults'],
  },
  'git.commit.message-language': {
    pi: execPi,
    src: [...gitSrc, 'src/git/commit-message.ts'],
    tests: ['test/git/commit-wave-bind.test.ts::commit-message generation respects the configured commit language'],
  },
  'git.commit.selected-files-only': {
    pi: execPi,
    src: [...gitSrc, 'src/git/cli.ts'],
    tests: ['test/git/commit-wave-bind.test.ts::a selected-file commit leaves unrelated staged and dirty files untouched', 'test/git/commit-bind.test.ts::a commit stages and commits the whole content of named files'],
  },
  'git.dry-run.skips-commits': {
    pi: execPi,
    src: exchangeSrc,
    tests: ['test/git/commit-wave-bind.test.ts::dry-run skips auto-commit and dirty checkpoints'],
  },
  'git.hooks.pre-commit-boundary': {
    pi: execPi,
    src: [...gitSrc, 'src/git/cli.ts'],
    tests: ['test/git/commit-wave-bind.test.ts::pre-commit hooks remain a trust boundary when verify is on', 'test/git/commit-wave-bind.test.ts::git-commit-verify off passes --no-verify so a failing pre-commit hook does not block'],
  },
  'git.config.auto-commits': {
    pi: ['pi.registerFlag'],
    src: ['src/git/options.ts', 'src/git/feature.ts', 'src/settings/load.ts', 'src/settings/resolve.ts'],
    tests: ['test/git/commit-wave-bind.test.ts::CLI env and YAML merge form the effective auto dirty and git option policy'],
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
