#!/usr/bin/env node
// Bind git startup/repo open rows closed by pm/git-startup.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const path = join(root, 'parity/ledger.json');
const ledger = JSON.parse(readFileSync(path, 'utf8'));

const startupSrc = ['src/git/startup.ts', 'src/git/feature.ts', 'src/git/policy.ts', 'src/git/options.ts', 'src/core/install.ts', 'src/settings/config-files.ts'];
const pi = ['Host.exec', 'Host.confirm'];
const tests = {
  discover: 'test/git/startup-bind.test.ts::discoverGitRoot finds the repository from a subdirectory the way findGitRoot does',
  setup: 'test/git/startup-bind.test.ts::setupGit offers init outside home, creates ignore patterns without a second confirm, and skips the home directory',
  sanity: 'test/git/startup-bind.test.ts::sanityCheckRepo refuses bare, corrupt, and index versions above 2, and accepts detached HEAD',
  open: 'test/git/startup-bind.test.ts::openSingleRoot returns one root and refuses zero or multiple roots',
  unavailable: 'test/git/startup-bind.test.ts::prepareGitRepository disables when git is off or the executable is missing, and opens a ready root otherwise',
  gitignore: 'test/git/startup-bind.test.ts::checkGitignore offers to append branding and .env patterns when --gitignore is on',
  worktree: 'test/git/startup-bind.test.ts::linked worktrees discover and pass sanity through the same Host.exec path',
};

/** @type {Record<string, { pi: string[]; src: string[]; tests: string[] }>} */
const bindings = {
  'git.startup.discover-root': { pi, src: startupSrc, tests: [tests.discover] },
  'git.startup.setup-repo': { pi, src: startupSrc, tests: [tests.setup] },
  'git.startup.sanity-check': { pi, src: startupSrc, tests: [tests.sanity] },
  'git.repo.open-single-root': { pi, src: startupSrc, tests: [tests.open] },
  'git.repo.unavailable': { pi, src: startupSrc, tests: [tests.unavailable] },
  'git.worktree.linked-and-index': { pi, src: startupSrc, tests: [tests.worktree, tests.sanity] },
  'git.config.gitignore-offer': { pi, src: startupSrc, tests: [tests.gitignore] },
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
