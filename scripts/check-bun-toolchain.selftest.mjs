#!/usr/bin/env node
// Proves every rule fires on a known-bad fixture and stays quiet on a clean one.
import { strict as assert } from 'node:assert';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { toolchainViolations } from './check-bun-toolchain.mjs';

const manifest = (extra = {}) => JSON.stringify({ name: 'fixture', private: true, workspaces: ['extensions/*'], scripts: { test: 'node runner.mjs' }, ...extra });

const clean = {
  'bun.lock': '',
  'package.json': manifest(),
  Makefile: 'verify:\n\tnode runner.mjs\n',
  'README.md': '## Verify\n\n```sh\nnode runner.mjs\n```\n',
  'runner.mjs': `import { execFileSync } from 'node:child_process';
execFileSync('node', ['--version']);
`,
};

async function fixture(overrides) {
  const directory = await mkdtemp(join(tmpdir(), 'bun-toolchain-'));
  for (const [path, body] of Object.entries({ ...clean, ...overrides })) {
    if (body === null) continue;
    await mkdir(dirname(join(directory, path)), { recursive: true });
    await writeFile(join(directory, path), body);
  }
  return directory;
}

const cases = [
  ['clean fixture', {}, []],
  ['missing lockfile', { 'bun.lock': null }, ['needs one Bun lockfile']],
  ['foreign lockfile', { 'package-lock.json': '{}' }, ['a second package manager lockfile']],
  ['missing workspace', { 'package.json': JSON.stringify({ name: 'fixture', private: true }) }, ['declare the extensions/* workspace']],
  ['npm in a package script', { 'package.json': manifest({ scripts: { test: 'npm test' } }) }, ['runs another package manager']],
  ['npm in a make recipe', { Makefile: 'verify:\n\tnpm run test\n' }, ['runs another package manager']],
  ['npm in a readme fence', { 'README.md': '## Verify\n\n```sh\nnpm install\n```\n' }, ['documents another package manager']],
  ['npm in a guide fence', { 'docs/guide.md': '## Verify\n\n```sh\nnpm install\n```\n' }, ['documents another package manager']],
  [
    'npm launched from a script',
    {
      'runner.mjs': `import { execFileSync } from 'node:child_process';
execFileSync('npm', ['test']);
`,
    },
    ['launches another package manager'],
  ],
];

for (const [name, overrides, expected] of cases) {
  const directory = await fixture(overrides);
  try {
    const { violations } = toolchainViolations(directory);
    assert.equal(violations.length, expected.length, `${name}: ${JSON.stringify(violations)}`);
    for (const fragment of expected) {
      assert.ok(
        violations.some((violation) => violation.includes(fragment)),
        `${name}: expected ${fragment} in ${JSON.stringify(violations)}`,
      );
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

process.stdout.write(`Bun toolchain self-test: ${cases.length} fixtures behaved as expected.\n`);
