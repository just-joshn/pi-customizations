import { execFileSync } from 'node:child_process';
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
