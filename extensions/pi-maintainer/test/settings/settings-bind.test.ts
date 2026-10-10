import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, onTestFinished, test } from 'vitest';
import { BRANDING } from '../../src/branding.ts';
import { editFeature } from '../../src/edit/feature.ts';
import { editOptionList, editOptions } from '../../src/edit/options.ts';
import { getPlatformInfo, getUserLanguage } from '../../src/edit/prompts/format.ts';
import { applyApiKeyPairs, applySetEnvPairs } from '../../src/settings/environment-pairs.ts';
import { formatSettings, scrubSensitiveInfo } from '../../src/settings/format-settings.ts';
import { loadSettings } from '../../src/settings/load.ts';

const notices = { output: () => {}, warning: () => {}, error: () => {} };
const host = {
  ...notices,
  confirm: async () => true,
  select: async () => undefined,
  exec: async () => ({ stdout: '', stderr: '', code: 0, killed: false }),
};

async function workspace() {
  const root = await mkdtemp(join(tmpdir(), 'pi-maintainer-settings-bind-'));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  const home = join(root, 'home');
  const repo = join(root, 'repo');
  const cwd = join(repo, 'pkg');
  for (const dir of [home, join(repo, '.git'), cwd]) await mkdir(dir, { recursive: true });
  return { root, home, repo, cwd };
}

const dotenvText = (values: Record<string, string>): string =>
  Object.entries(values)
    .map(([key, value]) => `${key}=${value}\n`)
    .join('');

test('named --env-file overrides earlier dotenv values in the extension environment', {
  meta: { aider: ['test_main/TestMain.test_env_file_override'] },
}, async () => {
  const { home, repo, cwd } = await workspace();
  const named = join(repo, 'named.env');
  await writeFile(join(home, '.env'), dotenvText({ A: 'home', B: 'home', C: 'home', D: 'home' }));
  await writeFile(join(repo, '.env'), dotenvText({ A: 'git', B: 'git', C: 'git' }));
  await writeFile(join(cwd, '.env'), dotenvText({ A: 'cwd', B: 'cwd' }));
  await writeFile(named, dotenvText({ A: 'named' }));
  const loaded = await loadSettings({
    specs: editOptionList,
    getFlag: (name) => (name === 'env-file' ? named : undefined),
    processEnvironment: { E: 'existing' },
    cwd,
    home,
  });
  expect(loaded.environment).toMatchObject({ A: 'named', B: 'cwd', C: 'git', D: 'home', E: 'existing' });
  expect(Object.hasOwn(process.env, 'A')).toBe(false);
});

test('oauth then cwd then default git-root env-file override shared keys', {
  meta: { aider: ['test_main/TestMain.test_load_dotenv_files_override'] },
}, async () => {
  const { home, repo, cwd } = await workspace();
  await mkdir(join(home, '.pi-maintainer'), { recursive: true });
  await writeFile(join(home, '.pi-maintainer', 'oauth-keys.env'), dotenvText({ OAUTH_VAR: 'oauth_val', SHARED_VAR: 'oauth_shared' }));
  await writeFile(join(repo, '.env'), dotenvText({ GIT_VAR: 'git_val', SHARED_VAR: 'git_shared' }));
  await writeFile(join(cwd, '.env'), dotenvText({ CWD_VAR: 'cwd_val', SHARED_VAR: 'cwd_shared' }));
  const loaded = await loadSettings({ specs: editOptionList, getFlag: () => undefined, processEnvironment: {}, cwd, home });
  expect(loaded.dotenvFiles[0]).toBe(join(home, '.pi-maintainer', 'oauth-keys.env'));
  expect(loaded.dotenvFiles.indexOf(join(cwd, '.env'))).toBeLessThan(loaded.dotenvFiles.indexOf(join(repo, '.env')));
  expect(loaded.environment).toMatchObject({ OAUTH_VAR: 'oauth_val', GIT_VAR: 'git_val', CWD_VAR: 'cwd_val', SHARED_VAR: 'git_shared' });
});

test('an explicit --env-file dotenv sets PI_MAINTAINER options for resolution', {
  meta: { aider: ['test_main/TestMain.test_env_file_flag_sets_automatic_variable'] },
}, async () => {
  const { home, cwd } = await workspace();
  const envFile = join(cwd, '.env.test');
  await writeFile(envFile, dotenvText({ PI_MAINTAINER_DRY_RUN: 'true' }));
  const loaded = await loadSettings({
    specs: editOptionList,
    getFlag: (name) => (name === 'env-file' ? envFile : undefined),
    processEnvironment: {},
    cwd,
    home,
  });
  expect(loaded.settings.value(editOptions.dryRun)).toBe(true);
  expect(loaded.settings.source(editOptions.dryRun)).toBe('env');
});

test('the default git-root .env sets PI_MAINTAINER options for resolution', {
  meta: { aider: ['test_main/TestMain.test_default_env_file_sets_automatic_variable'] },
}, async () => {
  const { home, repo, cwd } = await workspace();
  await writeFile(join(repo, '.env'), dotenvText({ PI_MAINTAINER_DRY_RUN: 'true' }));
  const loaded = await loadSettings({ specs: editOptionList, getFlag: () => undefined, processEnvironment: {}, cwd, home });
  expect(loaded.settings.value(editOptions.dryRun)).toBe(true);
});

test('cli encoding wins and reaches the edit working tree', {
  meta: { aider: ['test_main/TestMain.test_encodings_arg'] },
}, async () => {
  const { home, cwd } = await workspace();
  const loaded = await loadSettings({
    specs: editOptionList,
    getFlag: (name) => (name === 'encoding' ? 'iso-8859-15' : undefined),
    processEnvironment: {},
    cwd,
    home,
  });
  expect(loaded.settings.value(editOptions.encoding)).toBe('iso-8859-15');
  const ports = editFeature.create({ settings: loaded.settings, cwd, host });
  expect(ports.tree).toBeDefined();
  const path = join(cwd, 'latin.txt');
  await writeFile(path, Buffer.from([0xe9]));
  expect(await ports.tree.read(path)).toBe('é');
});

test('a single --set-env pair lands in the extension environment', {
  meta: { aider: ['test_main/TestMain.test_set_env_single'] },
}, async () => {
  const { home, cwd } = await workspace();
  const loaded = await loadSettings({
    specs: editOptionList,
    getFlag: (name) => (name === 'set-env' ? 'TEST_VAR=test_value' : undefined),
    processEnvironment: {},
    cwd,
    home,
  });
  expect(loaded.environment.TEST_VAR).toBe('test_value');
  expect(Object.hasOwn(process.env, 'TEST_VAR')).toBe(false);
});

test('multiple --set-env pairs each apply', {
  meta: { aider: ['test_main/TestMain.test_set_env_multiple'] },
}, () => {
  const result = applySetEnvPairs(['TEST_VAR1=value1', 'TEST_VAR2=value2'], {});
  expect(result.environment).toEqual({ TEST_VAR1: 'value1', TEST_VAR2: 'value2' });
  expect(result.problems).toEqual([]);
});

test('--set-env keeps internal spaces after trimming ends', {
  meta: { aider: ['test_main/TestMain.test_set_env_with_spaces'] },
}, () => {
  expect(applySetEnvPairs(['TEST_VAR=test value with spaces'], {}).environment.TEST_VAR).toBe('test value with spaces');
});

test('an invalid --set-env pair reports failure without writing', {
  meta: { aider: ['test_main/TestMain.test_set_env_invalid_format'] },
}, async () => {
  const { home, cwd } = await workspace();
  const loaded = await loadSettings({
    specs: editOptionList,
    getFlag: (name) => (name === 'set-env' ? 'INVALID_FORMAT' : undefined),
    processEnvironment: {},
    cwd,
    home,
  });
  expect(loaded.problems).toEqual(expect.arrayContaining(['Invalid --set-env format: INVALID_FORMAT', 'Format should be: ENV_VAR_NAME=value']));
  expect(loaded.environment.INVALID_FORMAT).toBeUndefined();
});

test('verbose diagnostics list dotenv-derived options and redact credential overlays', {
  meta: { aider: ['test_main/TestMain.test_verbose_mode_lists_env_vars'] },
}, async () => {
  const { home, repo, cwd } = await workspace();
  await writeFile(join(repo, '.env'), dotenvText({ PI_MAINTAINER_DRY_RUN: 'on' }));
  const loaded = await loadSettings({
    specs: editOptionList,
    getFlag: (name) => {
      if (name === 'set-env') return 'OPENAI_API_KEY=sk-secret-value-1234';
      if (name === 'api-key') return 'anthropic=anthro-secret-5678';
      if (name === 'verbose') return true;
      return undefined;
    },
    processEnvironment: {},
    cwd,
    home,
  });
  const report = formatSettings({
    dotenvFiles: loaded.dotenvFiles,
    environment: loaded.environment,
    environmentPrefix: BRANDING.envPrefix,
    options: editOptionList.map((spec) => ({ name: spec.name, value: loaded.settings.value(spec), source: loaded.settings.source(spec) })),
    secrets: loaded.secrets,
  });
  expect(report).toContain('PI_MAINTAINER_DRY_RUN');
  expect(report).toMatch(/dry-run:\s*True/);
  expect(report).toContain('sk-secret-value-1234'.slice(-4));
  expect(report).not.toContain('sk-secret-value-1234');
  expect(report).not.toContain('anthro-secret-5678');
  expect(scrubSensitiveInfo(['anthro-secret-5678'], 'anthro-secret-5678')).toBe('...5678');
  expect(applyApiKeyPairs(['anthropic=anthro-secret-5678'], {}).environment.ANTHROPIC_API_KEY).toBe('anthro-secret-5678');
});

test('chat-language from settings reaches platform context through the edit port', {
  meta: { aider: ['test_main/TestMain.test_chat_language_spanish'] },
}, async () => {
  const { home, cwd } = await workspace();
  const loaded = await loadSettings({
    specs: editOptionList,
    getFlag: (name) => (name === 'chat-language' ? 'Spanish' : undefined),
    processEnvironment: { LANG: 'en_US.UTF-8' },
    cwd,
    home,
  });
  const ports = editFeature.create({ settings: loaded.settings, cwd, host });
  expect(ports.chatLanguage).toBe('Spanish');
  const userLanguage = getUserLanguage({ chatLanguage: ports.chatLanguage, locale: 'en_US', env: loaded.environment });
  const platform = getPlatformInfo({
    platform: 'Linux-6.1',
    windows: false,
    env: { SHELL: '/bin/bash' },
    now: new Date('2026-10-10T12:00:00Z'),
    userLanguage,
    repo: true,
    lintCmds: null,
    autoLint: false,
    testCmd: null,
    autoTest: false,
  });
  expect(platform).toContain('Spanish');
});
