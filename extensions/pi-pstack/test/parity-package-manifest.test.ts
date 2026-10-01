import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

const root = fileURLToPath(new URL('../', import.meta.url));
const repositoryRoot = join(root, '..', '..');
const read = (path: string) => readFile(join(root, path), 'utf8');

interface Manifest {
  version: string;
  homepage: string;
  repository: { type: string; url: string; directory: string };
  files: string[];
  pi: { image: string };
  peerDependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  dependencies?: Record<string, string>;
}
const manifest = async () => JSON.parse(await read('package.json')) as Manifest;

test('the manifest declares a homepage and repository for the package directory', async () => {
  const { homepage, repository } = await manifest();
  expect(repository).toEqual({ type: 'git', url: 'git+https://github.com/just-joshn/pi-customizations.git', directory: 'extensions/pi-pstack' });
  expect(homepage).toBe('https://github.com/just-joshn/pi-customizations/tree/main/extensions/pi-pstack#readme');
});

test('pi.image is an https gallery URL for a logo shipped in the package', async () => {
  const { pi } = await manifest();
  const url = new URL(pi.image);
  expect(url.protocol).toBe('https:');
  const prefix = '/just-joshn/pi-customizations/main/';
  expect(url.pathname.startsWith(prefix)).toBe(true);
  const packagePath = url.pathname.slice(prefix.length).replace('extensions/pi-pstack/', '');
  expect(packagePath).toBe('upstream/assets/logo.png');
  expect(existsSync(join(root, packagePath))).toBe(true);
});

test.for(['@earendil-works/pi-ai', '@earendil-works/pi-coding-agent', '@earendil-works/pi-tui'])('host package %s stays a "*" peer as Pi packages require', async (name) => {
  const { peerDependencies, dependencies } = await manifest();
  expect(peerDependencies[name]).toBe('*');
  expect(dependencies?.[name]).toBeUndefined();
});

test('CHANGELOG.md ships and has an entry for the current package version', async () => {
  const { version, files } = await manifest();
  expect(files).toContain('CHANGELOG.md');
  const headings = (await read('CHANGELOG.md')).match(/^## .+$/gm) ?? [];
  expect(headings[0]).toMatch(new RegExp(`^## \\[?${version.replaceAll('.', '\\.')}\\]?`));
});

test('CHANGELOG.md lists every published pi revision of the pinned upstream', async () => {
  const text = await read('CHANGELOG.md');
  for (const revision of ['0.15.5-pi.1', '0.15.5-pi.2']) expect(text).toContain(`## ${revision}`);
});

test('git ignores .omc state directories under the package', () => {
  const output = execFileSync('git', ['check-ignore', '--no-index', '.omc/state/x'], { cwd: root, encoding: 'utf8' });
  expect(output.trim()).toBe('.omc/state/x');
});

test('the CI workflow runs the package checks for pull requests that touch it', async () => {
  const workflow = await readFile(join(repositoryRoot, '.github/workflows/pi-pstack.yml'), 'utf8');
  expect(workflow).toMatch(/^on:\n {2}pull_request:\n {4}paths:\n {6}- 'extensions\/pi-pstack\/\*\*'/m);
  expect(workflow).toContain('working-directory: extensions/pi-pstack');
  for (const script of ['check:resources', 'typecheck', 'test']) {
    expect(workflow).toMatch(new RegExp(`^\\s+(?:- )?run: bun run ${script}$`, 'm'));
  }
});
