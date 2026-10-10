import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, onTestFinished, test } from 'vitest';
import { editOptionList, editOptions } from '../../src/edit/options.ts';
import { loadSettings } from '../../src/settings/load.ts';
import { flagRegistrations, readFlags } from '../../src/settings/sources.ts';

async function workspace() {
  const root = await mkdtemp(join(tmpdir(), 'pi-maintainer-load-'));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  const home = join(root, 'home');
  const repo = join(root, 'repo');
  const cwd = join(repo, 'pkg');
  for (const dir of [home, join(repo, '.git'), cwd]) await mkdir(dir, { recursive: true });
  return { home, repo, cwd };
}

const noFlags = () => undefined;

const dotenvText = (values: Record<string, string>): string =>
  Object.entries(values)
    .map(([key, value]) => `${key}=${value}\n`)
    .join('');

test('.env values feed resolution but never the process environment', async () => {
  const { home, repo, cwd } = await workspace();
  await writeFile(join(home, '.env'), dotenvText({ PI_MAINTAINER_EDIT_FORMAT: 'diff', PI_MAINTAINER_ENCODING: 'latin-1' }));
  await writeFile(join(cwd, '.env'), dotenvText({ PI_MAINTAINER_EDIT_FORMAT: 'udiff', SHARED: 'cwd' }));
  await writeFile(join(repo, '.env'), dotenvText({ SHARED: 'git', PI_MAINTAINER_DRY_RUN: 'true' }));
  const loaded = await loadSettings({ specs: editOptionList, getFlag: noFlags, processEnvironment: { SHARED: 'shell' }, cwd, home });
  expect(loaded.settings.value(editOptions.editFormat)).toBe('udiff');
  expect(loaded.settings.value(editOptions.dryRun)).toBe(true);
  expect(loaded.settings.value(editOptions.encoding)).toBe('latin-1');
  expect(loaded.environment).toMatchObject({ SHARED: 'git' });
  expect(loaded.dotenvFiles).toEqual([join(home, '.env'), join(cwd, '.env'), join(repo, '.env')]);
  expect(Object.hasOwn(process.env, 'PI_MAINTAINER_EDIT_FORMAT')).toBe(false);
});

test('an --env-file named in a config file is read last', async () => {
  const { home, cwd } = await workspace();
  await writeFile(join(cwd, '.pi-maintainer.conf.yml'), 'env-file: settings.env\n');
  await writeFile(join(cwd, 'settings.env'), dotenvText({ PI_MAINTAINER_LINE_ENDINGS: 'crlf' }));
  await writeFile(join(cwd, '.env'), dotenvText({ PI_MAINTAINER_LINE_ENDINGS: 'lf' }));
  const loaded = await loadSettings({ specs: editOptionList, getFlag: noFlags, processEnvironment: {}, cwd, home });
  expect(loaded.settings.value(editOptions.lineEndings)).toBe('crlf');
  expect(loaded.settings.source(editOptions.lineEndings)).toBe('env');
});

test('the --config file outranks the default config files', async () => {
  const { home, cwd } = await workspace();
  await writeFile(join(cwd, '.pi-maintainer.conf.yml'), 'edit-format: diff\nencoding: ascii\n');
  await writeFile(join(home, 'team.yml'), 'edit-format: patch\n');
  const flags: Record<string, string> = { config: join(home, 'team.yml') };
  const loaded = await loadSettings({ specs: editOptionList, getFlag: (name) => flags[name], processEnvironment: {}, cwd, home });
  expect(loaded.settings.value(editOptions.editFormat)).toBe('patch');
  expect(loaded.settings.value(editOptions.encoding)).toBe('ascii');
  expect(loaded.settings.source(editOptions.editFormat)).toBe(join(home, 'team.yml'));
});

test('missing or malformed config files are reported', async () => {
  const { home, cwd } = await workspace();
  await writeFile(join(cwd, '.pi-maintainer.conf.yml'), '- not\n- a mapping\n');
  const flags: Record<string, string> = { config: 'absent.yml' };
  const loaded = await loadSettings({ specs: editOptionList, getFlag: (name) => flags[name], processEnvironment: {}, cwd, home });
  expect(loaded.problems).toEqual([
    `${join(cwd, '.pi-maintainer.conf.yml')}: The config file doesn't appear to contain 'key: value' pairs (aka. a YAML mapping). yaml.load('${join(cwd, '.pi-maintainer.conf.yml')}') returned type 'list' instead of 'dict'.`,
    `File not found: ${join(cwd, 'absent.yml')}`,
  ]);
});

test('a flag given with its no- form is reported; the no- form wins', () => {
  const flags: Record<string, boolean> = { 'dry-run': true, 'no-dry-run': true };
  const reading = readFlags([editOptions.dryRun], (name) => flags[name]);
  expect(reading.assignments.map((assignment) => assignment.raw)).toEqual([{ kind: 'switch', on: false }]);
  expect(reading.problems).toEqual(['--dry-run and --no-dry-run were all given; Pi does not report their order, so --no-dry-run wins']);
});

test('a list flag accepts configargparse list syntax', () => {
  const flags: Record<string, string> = { file: '[a.py, "b c.py"]', read: 'docs.md' };
  const reading = readFlags([editOptions.file, editOptions.read], (name) => flags[name]);
  expect(reading.assignments.map((assignment) => assignment.raw)).toEqual([
    { kind: 'items', items: ['a.py', '"b c.py"'] },
    { kind: 'text', text: 'docs.md' },
  ]);
});

test('options register every spelling as a Pi flag', () => {
  expect([editOptions.editFormat, editOptions.dryRun, editOptions.yesAlways, editOptions.file].flatMap(flagRegistrations).map(({ name, type }) => `${name}:${type}`)).toEqual([
    'edit-format:string',
    'chat-mode:string',
    'architect:boolean',
    'dry-run:boolean',
    'no-dry-run:boolean',
    'yes-always:boolean',
    'file:string',
  ]);
});
