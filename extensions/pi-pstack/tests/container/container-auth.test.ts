// What a container worker is given so its model provider works, decided from the host's auth.json and installed packages.
import { cpSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { findProviderPackages, MIN_OAUTH_LIFETIME_MS, prepareContainerAuth, ProviderAuthUnavailableError } from '../../src/container-auth.ts';

const FAKE_PACKAGE = join(import.meta.dirname, '../../test/fixtures/fake-provider');
const BUILTIN = new Set(['deepseek', 'anthropic']);
const NOW = 1_800_000_000_000;
const HOUR = 3_600_000;

let dir: string;
let agentDir: string;
let project: string;
beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'pstack-auth-')));
  agentDir = join(dir, 'agent');
  project = join(dir, 'project');
  mkdirSync(agentDir);
  mkdirSync(project);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const store = (credentials: Record<string, unknown>) => writeFileSync(join(agentDir, 'auth.json'), JSON.stringify(credentials));
const request = (provider: string, extra: Record<string, unknown> = {}) => ({ provider, source: { PI_CODING_AGENT_DIR: agentDir, HOME: dir }, projectRoot: project, builtin: BUILTIN, now: () => NOW, ...extra });
const installFakePackage = (settingsDir = agentDir, base = agentDir) => {
  cpSync(FAKE_PACKAGE, join(base, 'npm', 'node_modules', 'pstack-fake-provider'), { recursive: true });
  writeFileSync(join(settingsDir, 'settings.json'), JSON.stringify({ packages: ['npm:pstack-fake-provider@1.0.0'] }));
};

describe('an api_key provider', () => {
  test('gets only its own key, and a built-in provider needs no package', async () => {
    store({ deepseek: { type: 'api_key', key: 'ds-literal-key' }, anthropic: { type: 'api_key', key: 'decoy-key' } });

    const auth = await prepareContainerAuth(request('deepseek'));

    expect(JSON.parse(auth.authJson as string)).toEqual({ deepseek: { type: 'api_key', key: 'ds-literal-key' } });
    expect(auth).toMatchObject({ kind: 'api_key', expiresAt: null, packages: { mounts: [], extensions: [] } });
  });

  test('a key that is a command or an environment reference is resolved by Pi, or refused when there is no Pi to ask', async () => {
    store({ deepseek: { type: 'api_key', key: '!pass show deepseek' }, anthropic: { type: 'api_key', key: '$ANTHROPIC_KEY' } });

    await expect(prepareContainerAuth(request('deepseek'))).rejects.toThrow(/ProviderAuthUnavailable: .*command or an environment reference/);
    const asked: string[] = [];
    const auth = await prepareContainerAuth(request('deepseek', { resolve: async (provider: string) => (asked.push(provider), 'resolved-by-pi') }));

    expect(asked).toEqual(['deepseek']);
    expect(JSON.parse(auth.authJson as string)).toEqual({ deepseek: { type: 'api_key', key: 'resolved-by-pi' } });
  });

  test('a provider with nothing stored gets no auth.json, so env-keyed and keyless providers work as before', async () => {
    store({ anthropic: { type: 'api_key', key: 'decoy' } });

    expect(await prepareContainerAuth(request('deepseek'))).toMatchObject({ authJson: null, kind: 'none' });
    expect(await prepareContainerAuth(request('scripted'))).toMatchObject({ authJson: null, kind: 'none' });
  });
});

describe('an OAuth provider', () => {
  const oauth = (expires: number) => ({ type: 'oauth', access: 'at-ACCESS', refresh: 'rt-HOST-REFRESH', expires });

  test('gets the access token and an empty refresh token: the container can never rotate the host refresh token', async () => {
    store({ 'pstack-fake-oauth': oauth(NOW + 2 * HOUR), anthropic: { type: 'api_key', key: 'decoy' } });
    installFakePackage();

    const auth = await prepareContainerAuth(request('pstack-fake-oauth'));

    expect(JSON.parse(auth.authJson as string)).toEqual({ 'pstack-fake-oauth': { type: 'oauth', access: 'at-ACCESS', refresh: '', expires: NOW + 2 * HOUR } });
    expect(auth.authJson).not.toContain('rt-HOST-REFRESH');
    expect(auth).toMatchObject({ kind: 'oauth', expiresAt: NOW + 2 * HOUR });
  });

  test('a token near expiry is refreshed by the host first, and the container gets the new one', async () => {
    store({ 'pstack-fake-oauth': oauth(NOW + 2 * 60_000) });
    installFakePackage();
    const refreshed: string[] = [];
    const resolve = async (provider: string) => {
      refreshed.push(provider);
      store({ 'pstack-fake-oauth': { type: 'oauth', access: 'at-NEW', refresh: 'rt-ROTATED-ON-HOST', expires: NOW + 8 * HOUR } });
    };

    const auth = await prepareContainerAuth(request('pstack-fake-oauth', { resolve }));

    expect(refreshed).toEqual(['pstack-fake-oauth']);
    expect(JSON.parse(auth.authJson as string)).toEqual({ 'pstack-fake-oauth': { type: 'oauth', access: 'at-NEW', refresh: '', expires: NOW + 8 * HOUR } });
  });

  test('a token that is near expiry, with nobody to refresh it, or that stays near expiry after the refresh, refuses the spawn and says why', async () => {
    store({ 'pstack-fake-oauth': oauth(NOW + 3 * 60_000) });
    installFakePackage();

    await expect(prepareContainerAuth(request('pstack-fake-oauth'))).rejects.toThrow(/ProviderAuthUnavailable: .*expires in 3 min.*cannot refresh it/);
    await expect(prepareContainerAuth(request('pstack-fake-oauth', { resolve: async () => undefined }))).rejects.toBeInstanceOf(ProviderAuthUnavailableError);
    store({ 'pstack-fake-oauth': oauth(NOW - 1000) });
    await expect(prepareContainerAuth(request('pstack-fake-oauth'))).rejects.toThrow(/has expired/);
  });

  test('the minimum life is the default 10 minutes unless the caller lowers it', async () => {
    store({ 'pstack-fake-oauth': oauth(NOW + MIN_OAUTH_LIFETIME_MS - 1) });
    installFakePackage();

    await expect(prepareContainerAuth(request('pstack-fake-oauth'))).rejects.toThrow(/expires in/);
    await expect(prepareContainerAuth(request('pstack-fake-oauth', { minOAuthValidityMs: 0 }))).resolves.toMatchObject({ kind: 'oauth' });
  });
});

describe('the packages that register a provider', () => {
  test('are found in the user settings by their source, and only the matching package is taken', () => {
    installFakePackage();
    cpSync(FAKE_PACKAGE, join(agentDir, 'npm', 'node_modules', 'unrelated'), { recursive: true });
    writeFileSync(join(agentDir, 'npm', 'node_modules', 'unrelated', 'index.ts'), 'export default function () {}\n');
    writeFileSync(join(agentDir, 'settings.json'), JSON.stringify({ packages: ['npm:unrelated', { source: 'npm:pstack-fake-provider@1.0.0' }, 'git:github.com/x/y'] }));

    const found = findProviderPackages('pstack-fake-oauth', agentDir, project);

    expect(found.mounts).toEqual([join(agentDir, 'npm', 'node_modules', 'pstack-fake-provider')]);
    expect(found.extensions).toEqual([join(agentDir, 'npm', 'node_modules', 'pstack-fake-provider', 'index.ts')]);
  });

  test('are found in the project settings, and a local path source resolves against its settings file', () => {
    mkdirSync(join(project, '.pi'));
    cpSync(FAKE_PACKAGE, join(project, 'local-pkg'), { recursive: true });
    writeFileSync(join(project, '.pi', 'settings.json'), JSON.stringify({ packages: ['../local-pkg'] }));

    expect(findProviderPackages('pstack-fake-key', agentDir, project).extensions).toEqual([join(project, 'local-pkg', 'index.ts')]);
  });

  test('dependencies a hoisted install keeps beside the package are mounted with it', () => {
    const pkg = join(agentDir, 'npm', 'node_modules', 'with-deps');
    mkdirSync(pkg, { recursive: true });
    mkdirSync(join(agentDir, 'npm', 'node_modules', 'dep-a'), { recursive: true });
    mkdirSync(join(agentDir, 'npm', 'node_modules', 'dep-b'), { recursive: true });
    writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: 'with-deps', pi: { extensions: ['./index.ts'] }, dependencies: { 'dep-a': '1' } }));
    writeFileSync(join(pkg, 'index.ts'), "pi.registerProvider({ id: 'deps-provider' });\n");
    writeFileSync(join(agentDir, 'npm', 'node_modules', 'dep-a', 'package.json'), JSON.stringify({ name: 'dep-a', dependencies: { 'dep-b': '1' } }));
    writeFileSync(join(agentDir, 'settings.json'), JSON.stringify({ packages: ['npm:with-deps'] }));

    const found = findProviderPackages('deps-provider', agentDir, project);

    expect(found.mounts).toEqual([pkg, join(agentDir, 'npm', 'node_modules', 'dep-a'), join(agentDir, 'npm', 'node_modules', 'dep-b')]);
  });

  test('a stored credential for a provider no package registers refuses the spawn, naming the override', async () => {
    store({ 'pstack-fake-oauth': { type: 'oauth', access: 'at', refresh: 'rt', expires: NOW + 2 * HOUR } });

    await expect(prepareContainerAuth(request('pstack-fake-oauth'))).rejects.toThrow(/ProviderAuthUnavailable: .*no installed Pi package.*PSTACK_CONTAINER_PROVIDER_PACKAGES/);
    const explicit = join(dir, 'explicit');
    cpSync(FAKE_PACKAGE, explicit, { recursive: true });
    expect((await prepareContainerAuth(request('pstack-fake-oauth', { packages: [explicit] }))).packages.extensions).toEqual([join(explicit, 'index.ts')]);
    expect(existsSync(join(agentDir, 'settings.json'))).toBe(false);
  });
});
