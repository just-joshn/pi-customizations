import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { expect, onTestFinished, test } from 'vitest';
import { mergePackageEntry } from '../scripts/benny-settings.mjs';
import { bennyCommitted, installBenny, nativeBennyFiles } from '../scripts/benny-setup.mjs';
import { expectDefined } from './support/expect-defined.ts';

const run = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const setupText = async () => expectDefined((await nativeBennyFiles())['skills/setup-benny/SKILL.md']);

async function project(prefix: string) {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  onTestFinished(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

const choices = [
  'Source Slack channel ID',
  'Optional operations or status channel ID',
  'Repository URL and default branch',
  'Triage identity or Slack user ID',
  'Issue tracker type, team, project, labels, and intake status',
  'Tracker adapter actions',
  'Optional routing map path',
  'Required control skill name',
  'Required user-facing feature-map path',
  'Status emoji strings',
  'Pull request URL format',
  'Polling and effort budgets',
  'Provider/model identity for triage, repro, code work, and media review',
];

test.for(choices.map((choice, index) => ({ choice, number: index + 1 })))('setup step 2 asks for choice $number: $choice', async ({ choice, number }) => {
  expect(await setupText()).toContain(`${number}. ${choice}`);
});

test('setup names exactly thirteen numbered choices', async () => {
  const section = (await setupText()).split('Ask for or confirm all thirteen choices:\n\n')[1]?.split('\n\n')[0] ?? '';
  expect(section.split('\n')).toHaveLength(13);
});

test('setup bans guessed model slugs and a carried-over private default', async () => {
  expect(await setupText()).toContain("Use only provider/model identities shown in Pi's available model registry. Do not guess a slug and do not carry over a private default.");
});

test('setup runs unslop on automation names before AutomationPrepare', async () => {
  const text = await setupText();
  expect(text).toContain(
    'Run the `unslop` skill on the final automation names, descriptions, and prompt shims before calling `AutomationPrepare`.',
  );
  expect(text.indexOf('Run the `unslop` skill')).toBeLessThan(text.indexOf('AutomationPrepare'));
  expect(text).toContain('host `/automate` skill');
  expect(text).not.toMatch(/Call `Routine(?:Prepare|Enable)`/);
});

test('install creates project settings that load the pi-pstack package', async () => {
  const target = await project('pstack-benny-settings-');
  const result = await installBenny(target);
  expect(result).toMatchObject({ enabled: false, conflicts: [], settings: 'created' });
  const settings = JSON.parse(await readFile(join(target, '.pi/settings.json'), 'utf8')) as { packages: string[] };
  expect(settings.packages).toEqual([root.replace(/\/$/, '')]);
});

test('install honors an explicit package source', async () => {
  const target = await project('pstack-benny-source-');
  await installBenny(target, { packageSource: 'git:github.com/example/pi-pstack@v1' });
  const settings = JSON.parse(await readFile(join(target, '.pi/settings.json'), 'utf8')) as { packages: string[] };
  expect(settings.packages).toEqual(['git:github.com/example/pi-pstack@v1']);
});

test('install keeps unrelated settings, comments, and other packages', async () => {
  const target = await project('pstack-benny-merge-');
  await mkdir(join(target, '.pi'));
  const original = '{\n  // team defaults\n  "theme": "dark",\n  "packages": [\n    "npm:other-package", // keep\n  ],\n}\n';
  await writeFile(join(target, '.pi/settings.json'), original);
  const result = await installBenny(target, { packageSource: '/opt/pi-pstack' });
  expect(result.settings).toBe('updated');
  const text = await readFile(join(target, '.pi/settings.json'), 'utf8');
  expect(text).toContain('// team defaults');
  expect(text).toContain('"npm:other-package", // keep');
  expect(text).toContain('"theme": "dark"');
  expect(text).toContain('"/opt/pi-pstack"');
});

test('a second install leaves an existing pi-pstack entry unchanged', async () => {
  const target = await project('pstack-benny-idempotent-');
  await installBenny(target, { packageSource: '/opt/pi-pstack' });
  const before = await readFile(join(target, '.pi/settings.json'), 'utf8');
  const again = await installBenny(target, { packageSource: '/opt/pi-pstack' });
  expect(again.settings).toBe('unchanged');
  expect(await readFile(join(target, '.pi/settings.json'), 'utf8')).toBe(before);
});

test.for([
  { name: 'an empty file', input: '', expected: { packages: ['/p'] } },
  { name: 'an empty object', input: '{}', expected: { packages: ['/p'] } },
  { name: 'settings without packages', input: '{ "theme": "dark" }', expected: { theme: 'dark', packages: ['/p'] } },
  { name: 'an object entry for the same source', input: '{ "packages": [{ "source": "/p", "skills": [] }] }', expected: { packages: [{ source: '/p', skills: [] }] } },
  { name: 'an empty packages array', input: '{ "packages": [] }', expected: { packages: ['/p'] } },
  { name: 'a trailing comma', input: '{ "theme": "dark", }', expected: { theme: 'dark', packages: ['/p'] } },
])('mergePackageEntry handles $name', ({ input, expected }) => {
  const merged = mergePackageEntry(input, '/p').text;
  const stripped = merged.replace(/^\s*\/\/.*$/gm, '').replace(/,(\s*[}\]])/g, '$1');
  expect(JSON.parse(stripped)).toEqual(expected);
});

test('mergePackageEntry rejects a settings file that is not an object', () => {
  expect(() => mergePackageEntry('[1]', '/p')).toThrow('must contain a JSON object');
  expect(() => mergePackageEntry('{ "packages": "x" }', '/p')).toThrow('"packages" must be an array');
});

test('an uncommitted project settings file blocks readiness', async () => {
  const target = await project('pstack-benny-settings-commit-');
  await run('git', ['init', '--quiet'], { cwd: target });
  await installBenny(target, { packageSource: '/opt/pi-pstack' });
  await run('git', ['add', '.pi/automations', '.pi/skills'], { cwd: target });
  await run('git', ['-c', 'user.name=Benny fixture', '-c', 'user.email=benny@example.invalid', 'commit', '--quiet', '-m', 'Pack without settings'], { cwd: target });
  await expect(bennyCommitted(target)).rejects.toThrow();
});

test('a fresh Pi process loads the pi-pstack extension from project settings', async () => {
  const target = await project('pstack-benny-extension-');
  await installBenny(target);
  const { stdout } = await run(process.execPath, ['test/benny-parity-discovery.mjs', target], { cwd: root });
  const result = JSON.parse(stdout) as { extensions: string[]; errors: unknown[] };
  expect(result.errors).toEqual([]);
  expect(result.extensions).toContain(join(root.replace(/\/$/, ''), 'src/index.ts'));
});
