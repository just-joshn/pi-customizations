import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from 'vitest';
import { claudeKeychainService, importClaudeAiOauth } from '../src/claude-credentials.ts';

const BLOB = JSON.stringify({ claudeAiOauth: { accessToken: 'a', refreshToken: 'r', expiresAt: 5 } });

async function configDir(onTestFinished: (cleanup: () => Promise<void>) => void): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'claude-storage-'));
  onTestFinished(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test('a custom OAuth base selects the custom keychain service', () => {
  const env = { CLAUDE_CODE_CUSTOM_OAUTH_URL: 'https://claude.fedstart.com' };
  expect(claudeKeychainService(env, () => '/home/u')).toBe('Claude Code-custom-oauth-credentials');
  expect(claudeKeychainService({}, () => '/home/u')).toBe('Claude Code-credentials');
});

test('a regular credentials file imports', async ({ onTestFinished }) => {
  const dir = await configDir(onTestFinished);
  await writeFile(join(dir, '.credentials.json'), BLOB);
  await expect(importClaudeAiOauth({ platform: 'linux', env: { CLAUDE_CONFIG_DIR: dir } })).resolves.toMatchObject({ access: 'a', refresh: 'r', expires: 5 });
});

test('a symlinked credentials file is refused like Claude refuses it', async ({ onTestFinished }) => {
  const dir = await configDir(onTestFinished);
  await writeFile(join(dir, 'real.json'), BLOB);
  await symlink(join(dir, 'real.json'), join(dir, '.credentials.json'));
  await expect(importClaudeAiOauth({ platform: 'linux', env: { CLAUDE_CONFIG_DIR: dir } })).rejects.toThrow('No Claude Code credentials found to import.');
});

test('a credentials file over 1 MiB reads as absent', async ({ onTestFinished }) => {
  const dir = await configDir(onTestFinished);
  await writeFile(join(dir, '.credentials.json'), `${BLOB}${' '.repeat(1_048_577)}`);
  await expect(importClaudeAiOauth({ platform: 'linux', env: { CLAUDE_CONFIG_DIR: dir } })).rejects.toThrow('No Claude Code credentials found to import.');
});
