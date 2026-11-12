// A real-model sandbox loads the operator's package that registers a provider, and refuses an OAuth token that would be refreshed mid-run.
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

import { assertOauthOutlastsRun, packagesRegistering } from './lib/providers.ts';

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

describe('assertOauthOutlastsRun', () => {
  const auth = (expires: number) => {
    const file = join(mkdtempSync(join(tmpdir(), 'oauth-test-')), 'auth.json');
    writeFileSync(file, JSON.stringify({ 'claude-subscription': { type: 'oauth', expires }, deepseek: { type: 'api_key', key: 'k' } }));
    return file;
  };
  const now = 1_000_000_000_000;
  test('a token that outlasts the run passes', () => {
    expect(() => assertOauthOutlastsRun(auth(now + 90 * 60_000), ['claude-subscription'], 60 * 60_000, now)).not.toThrow();
  });
  test('a token that expires inside the run is refused, since a sandbox refresh would revoke the operator\'s', () => {
    expect(() => assertOauthOutlastsRun(auth(now + 20 * 60_000), ['claude-subscription'], 60 * 60_000, now)).toThrow(/claude-subscription.*expires in 20 min/);
  });
  test('a provider that is not OAuth is never refused', () => {
    expect(() => assertOauthOutlastsRun(auth(now - 1), ['deepseek'], 60 * 60_000, now)).not.toThrow();
  });
});
