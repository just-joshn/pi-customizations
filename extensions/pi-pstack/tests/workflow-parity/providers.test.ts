// A real-model sandbox loads the operator's package that registers a provider, and refuses an OAuth token that would be refreshed mid-run.
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

import { packagesRegistering, withoutOauthRefresh } from './lib/providers.ts';

function agentDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'providers-test-'));
  const pkg = (name: string, source: string, pi: boolean) => {
    const root = join(dir, 'npm', 'node_modules', name);
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'package.json'), JSON.stringify(pi ? { name, pi: { extensions: ['./src/index.ts'] } } : { name }));
    writeFileSync(join(root, 'src', 'index.ts'), source);
  };
  pkg('@x/oauth', "const PROVIDER_ID = 'claude-subscription';", true);
  pkg('@x/other', "const PROVIDER_ID = 'antigravity';", true);
  pkg('@x/library', "const PROVIDER_ID = 'claude-subscription';", false);
  writeFileSync(join(dir, 'settings.json'), JSON.stringify({ packages: ['npm:@x/oauth', 'npm:@x/other', 'npm:@x/library', 'git:somewhere'] }));
  return dir;
}

describe('packagesRegistering', () => {
  test('finds the Pi package that names the provider, and neither another provider nor a package that is no Pi extension', () => {
    const dir = agentDir();
    expect(packagesRegistering('claude-subscription', dir)).toEqual([join(dir, 'npm', 'node_modules', '@x/oauth')]);
    expect(packagesRegistering('deepseek', dir)).toEqual([]);
  });
});

describe('withoutOauthRefresh', () => {
  test('the sandbox copy keeps the OAuth access token but never the refresh token, and leaves API keys alone', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'oauth-test-')), 'auth.json');
    writeFileSync(file, JSON.stringify({ 'claude-subscription': { type: 'oauth', access: 'a', refresh: 'r', expires: 1 }, deepseek: { type: 'api_key', key: 'k' } }));
    withoutOauthRefresh(file);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ 'claude-subscription': { type: 'oauth', access: 'a', refresh: '', expires: 1 }, deepseek: { type: 'api_key', key: 'k' } });
  });
});
