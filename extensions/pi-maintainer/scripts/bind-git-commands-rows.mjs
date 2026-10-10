#!/usr/bin/env node
// Bind git commands/diff/security rows closed by pm/git-commands.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const path = join(root, 'parity/ledger.json');
const ledger = JSON.parse(readFileSync(path, 'utf8'));

const gitSrc = ['src/git/feature.ts', 'src/git/policy.ts', 'src/git/options.ts', 'src/git/commands.ts', 'src/index.ts'];
const execPi = ['Host.exec'];
const commandPi = ['pi.registerCommand', 'Host.exec'];

/** @type {Record<string, { pi: string[]; src: string[]; tests: string[] }>} */
const bindings = {
  'git.diff.for-commit-message': {
    pi: execPi,
    src: gitSrc,
    tests: [
      'test/git/diffs-bind.test.ts::commit-message diffs include staged and unstaged changes against HEAD',
      'test/git/diffs-bind.test.ts::commit-message diffs keep non-ASCII working-tree bytes for the model prompt',
      'test/git/diffs-bind.test.ts::unborn-branch diffs use cached and working-tree diffs without a HEAD comparison',
      'test/git/diffs-bind.test.ts::diffCommits returns the patch between two revisions',
    ],
  },
  'git.diff.cmd-display': {
    pi: commandPi,
    src: gitSrc,
    tests: [
      'test/git/diffs-bind.test.ts::/diff uses HEAD^ with fewer than two message checkpoints and the second-last checkpoint otherwise',
      'test/git/diffs-bind.test.ts::diffCommits returns the patch between two revisions',
    ],
  },
  'git.diff.detached-and-unborn': {
    pi: execPi,
    src: gitSrc,
    tests: [
      'test/git/diffs-bind.test.ts::unborn-branch diffs use cached and working-tree diffs without a HEAD comparison',
      'test/git/diffs-bind.test.ts::detached HEAD diffs use cached plus working-tree paths rather than active-branch HEAD',
    ],
  },
  'git.commands.raw-git': {
    pi: commandPi,
    src: gitSrc,
    tests: [
      'test/git/commands-bind.test.ts::/git runs argv git with GIT_EDITOR=true from process cwd and shows combined output',
    ],
  },
  'git.commands.commit': {
    pi: commandPi,
    src: gitSrc,
    tests: ['test/git/commands-bind.test.ts::/commit commits dirty working-tree changes with an optional message'],
  },
  'git.commands.add-from-subdir': {
    pi: ['pi.registerCommand'],
    src: ['src/edit/selection.ts', 'src/edit/commands.ts', 'src/git/feature.ts'],
    tests: [
      'test/git/commands-bind.test.ts::/add from a subdirectory resolves paths relative to the repository root',
      'test/git/commands-bind.test.ts::/add from a nested cwd admits an untracked file under that subdirectory',
      'test/git/commands-bind.test.ts::/add expands a git-tracked directory whose name contains glob metacharacters',
    ],
  },
  'git.commands.add-untracked': {
    pi: ['pi.registerCommand'],
    src: ['src/edit/selection.ts', 'src/edit/commands.ts'],
    tests: ['test/git/commands-bind.test.ts::/add and /drop admit untracked files without staging them into git'],
  },
  'git.security.path-trust': {
    pi: ['pi.registerCommand'],
    src: ['src/core/chat-files.ts', 'src/edit/selection.ts'],
    tests: [
      'test/git/security-bind.test.ts::path helpers resolve symlinks while getRelFname still accepts paths outside the root',
      'test/git/security-bind.test.ts::/add outside-root refusal stays conditional on automatic commits for non-image files',
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
