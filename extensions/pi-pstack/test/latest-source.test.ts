import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from 'vitest';

const git = (repo: string, ...args: string[]) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();

const sourceTest = test.extend<{ source: { directory: string; repo: string; check: () => string } }>({
  source: async ({ task: _task }, use) => {
    const directory = await mkdtemp(join(tmpdir(), 'pstack-source-check-'));
    const repo = join(directory, 'repo');
    try {
      for (const path of ['repo/pstack', 'scripts', 'docs', 'upstream']) await mkdir(join(directory, path), { recursive: true });
      await writeFile(join(repo, 'pstack/README.md'), 'Cursor cursor-team-kit .cursor\n');
      await writeFile(join(repo, 'pstack/image.png'), Buffer.from([0xff, 0x00, 0x80]));
      git(repo, 'init', '-q');
      git(repo, 'add', '.');
      git(repo, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture');
      const commit = git(repo, 'rev-parse', 'HEAD');
      await writeFile(join(directory, 'docs/provenance.json'), JSON.stringify({ pstack: { commit, path: 'pstack' } }));
      await writeFile(join(directory, 'docs/source-inventory.json'), JSON.stringify([{ path: 'README.md' }, { path: 'image.png' }]));
      await writeFile(join(directory, 'upstream/README.md'), 'Reference team-kit .upstream\n');
      await copyFile(join(repo, 'pstack/image.png'), join(directory, 'upstream/image.png'));
      await copyFile(new URL('../scripts/check-latest-source.mjs', import.meta.url), join(directory, 'scripts/check-latest-source.mjs'));
      await use({ directory, repo, check: () => execFileSync(process.execPath, [join(directory, 'scripts/check-latest-source.mjs'), repo], { encoding: 'utf8', stdio: 'pipe' }) });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
});

async function migrateTestSource(source: { directory: string; repo: string }) {
  const path = 'skills/poteto-mode/scripts/watch-pr/cli.test.ts';
  const before = 'import { expect } from "bun:test";\n';
  const after = 'import { expect } from "vitest";\n';
  const hash = (text: string) => createHash('sha256').update(text).digest('hex');
  for (const base of [join(source.repo, 'pstack'), join(source.directory, 'upstream')]) await mkdir(join(base, 'skills/poteto-mode/scripts/watch-pr'), { recursive: true });
  await writeFile(join(source.repo, 'pstack', path), before);
  git(source.repo, 'add', '.');
  git(source.repo, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'helper test');
  await writeFile(join(source.directory, 'docs/provenance.json'), JSON.stringify({ pstack: { commit: git(source.repo, 'rev-parse', 'HEAD'), path: 'pstack' } }));
  await writeFile(join(source.directory, 'docs/source-inventory.json'), JSON.stringify([{ path: 'README.md' }, { path: 'image.png' }, { path, sha256: hash(after) }]));
  await writeFile(join(source.directory, 'upstream', path), after);
  const migration = { path, sourceSha256: hash(before), migratedSha256: hash(after), edits: [{ offset: 0, before: [before], after: [after] }] };
  await writeFile(join(source.directory, 'docs/vitest-source-migration.json'), JSON.stringify([migration]));
  return migration;
}

sourceTest('the source checker accepts replayed test-runner adaptations', async ({ source }) => {
  await migrateTestSource(source);
  expect(source.check()).toMatch(/^Verified 3 normalized pstack source files against [a-f0-9]{40}\.\n$/);
});

sourceTest('the source checker rejects an adaptation of a different pinned source', async ({ source }) => {
  const migration = await migrateTestSource(source);
  await writeFile(join(source.directory, 'docs/vitest-source-migration.json'), JSON.stringify([{ ...migration, sourceSha256: '0'.repeat(64) }]));
  expect(source.check).toThrow('Test migration source hash differs: skills/poteto-mode/scripts/watch-pr/cli.test.ts');
});

sourceTest('the source checker rejects edits that do not match their original lines', async ({ source }) => {
  const migration = await migrateTestSource(source);
  await writeFile(join(source.directory, 'docs/vitest-source-migration.json'), JSON.stringify([{ ...migration, edits: [{ offset: 0, before: ['wrong source\n'], after: ['import { expect } from "vitest";\n'] }] }]));
  expect(source.check).toThrow('Test migration edit differs: skills/poteto-mode/scripts/watch-pr/cli.test.ts');
});

sourceTest('the source checker rejects migrated content drift despite a refreshed inventory', async ({ source }) => {
  const migration = await migrateTestSource(source);
  const drift = 'import { expect } from "vitest";\n// unrecorded change\n';
  await writeFile(join(source.directory, 'upstream', migration.path), drift);
  await writeFile(join(source.directory, 'docs/source-inventory.json'), JSON.stringify([{ path: 'README.md' }, { path: 'image.png' }, { path: migration.path, sha256: createHash('sha256').update(drift).digest('hex') }]));
  expect(source.check).toThrow('Normalized source differs: skills/poteto-mode/scripts/watch-pr/cli.test.ts');
});

sourceTest('the source checker rejects a migration with an invalid line offset', async ({ source }) => {
  const migration = await migrateTestSource(source);
  await writeFile(join(source.directory, 'docs/vitest-source-migration.json'), JSON.stringify([{ ...migration, edits: [{ offset: -1, before: [], after: [] }] }]));
  expect(source.check).toThrow('Invalid test-runner source migration.');
});

sourceTest('the source checker rejects a migration with the wrong resulting hash', async ({ source }) => {
  const migration = await migrateTestSource(source);
  await writeFile(join(source.directory, 'docs/vitest-source-migration.json'), JSON.stringify([{ ...migration, migratedSha256: '0'.repeat(64) }]));
  expect(source.check).toThrow('Test migration result hash differs: skills/poteto-mode/scripts/watch-pr/cli.test.ts');
});

sourceTest('the source checker rejects migrations absent from the pinned Git tree', async ({ source }) => {
  const migration = await migrateTestSource(source);
  await writeFile(join(source.directory, 'docs/vitest-source-migration.json'), JSON.stringify([{ ...migration, path: 'skills/poteto-mode/scripts/watch-pr/policy.test.ts' }]));
  expect(source.check).toThrow('Test migration has no pinned source: skills/poteto-mode/scripts/watch-pr/policy.test.ts');
});

sourceTest('the source checker verifies normalized text and untouched binary bytes', async ({ source }) => {
  expect(source.check()).toMatch(/^Verified 2 normalized pstack source files against [a-f0-9]{40}\.\n$/);
  expect(await readFile(join(source.directory, 'upstream/image.png'))).toEqual(Buffer.from([0xff, 0x00, 0x80]));
});

sourceTest('the source checker rejects snapshot content drift', async ({ source }) => {
  await writeFile(join(source.directory, 'upstream/README.md'), 'Wrong source');
  expect(source.check).toThrow('Normalized source differs: README.md');
});

sourceTest('the source checker rejects files absent from its source inventory', async ({ source }) => {
  await writeFile(join(source.directory, 'docs/source-inventory.json'), '[]');
  expect(source.check).toThrow('Source is not inventoried: README.md');
});

sourceTest('the source checker rejects invalid revision input before git runs', async ({ source }) => {
  await writeFile(join(source.directory, 'docs/provenance.json'), JSON.stringify({ pstack: { commit: '--help', path: 'pstack' } }));
  expect(source.check).toThrow('Invalid pinned pstack provenance.');
});
