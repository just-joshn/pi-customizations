#!/usr/bin/env node
// Bind GitPolicy port rows closed by pm/git-policy (inventory, authorize, dirty, commit, undo).
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
  'git.inventory.tracked-files': {
    pi: execPi,
    src: [...gitSrc, 'src/git/cli.ts'],
    tests: [
      'test/git/inventory-bind.test.ts::tracked inventory merges committed blobs and index entries without unstaged untracked files',
      'test/git/inventory-bind.test.ts::aiderignore excludes matching tracked paths from inventory',
    ],
  },
  'git.authorize.skip-gitignored': {
    pi: execPi,
    src: [...gitSrc, 'src/core/exchange.ts'],
    tests: ['test/git/authorize-bind.test.ts::gitignored paths are skipped with the Aider skip warning'],
  },
  'git.authorize.stage-new-file': {
    pi: execPi,
    src: gitSrc,
    tests: [
      'test/git/authorize-bind.test.ts::an untracked approved path is staged when automatic commits are on',
      'test/git/authorize-bind.test.ts::stageNewFile is a no-op when automatic commits are off',
    ],
  },
  'git.dirty.off-without-auto-commits': {
    pi: execPi,
    src: ['src/git/options.ts', 'src/git/policy.ts', 'src/git/feature.ts'],
    tests: [
      'test/git/dirty-bind.test.ts::turning automatic commits off also turns dirty commits off',
      'test/git/dirty-bind.test.ts::dirtyCommit is disabled when automatic commits forced dirty commits off',
    ],
  },
  'git.dirty.checkpoint-before-edit': {
    pi: execPi,
    src: [...gitSrc, 'src/core/exchange.ts'],
    tests: ['test/git/dirty-bind.test.ts::dirty paths are announced and checkpointed before edits when dirty commits are on'],
  },
  'git.commit.stage-whole-files': {
    pi: execPi,
    src: [...gitSrc, 'src/git/cli.ts'],
    tests: ['test/git/commit-bind.test.ts::a commit stages and commits the whole content of named files'],
  },
  'git.commit.message-context': {
    pi: execPi,
    src: [...gitSrc, 'src/git/commit-message.ts'],
    tests: [
      'test/git/commit-bind.test.ts::commit message generation sends the commit diff and the chat context',
      'test/git/commit-bind.test.ts::buildCommitMessageRequest places context above the diffs block',
    ],
  },
  'git.undo.preconditions': {
    pi: execPi,
    src: gitSrc,
    tests: [
      'test/git/undo-bind.test.ts::undo refuses without a repository, on the first commit, and when HEAD is not a session commit',
      'test/git/undo-bind.test.ts::undo refuses when a changed file is dirty after the session commit',
    ],
  },
  'git.undo.restore-and-reset': {
    pi: execPi,
    src: gitSrc,
    tests: ['test/git/undo-bind.test.ts::undo checks out files from the parent, soft-resets, and reports Removed'],
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
