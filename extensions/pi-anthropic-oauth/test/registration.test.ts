import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createModels } from '@earendil-works/pi-ai';
import { builtinProviders } from '@earendil-works/pi-ai/providers/all';
import { discoverAndLoadExtensions, type ExtensionFactory } from '@earendil-works/pi-coding-agent';
import { expect } from 'vitest';
import extension from '../src/index.ts';
import { test } from './network-guard.ts';
import { captureProvider } from './support/load-extension.ts';
import { declaredExtensions } from './support/package-manifest.ts';

const PACKAGE_DIR = fileURLToPath(new URL('..', import.meta.url));

test('the published package includes its parity reference', async () => {
  const manifest: unknown = JSON.parse(await readFile(join(PACKAGE_DIR, 'package.json'), 'utf8'));
  expect(manifest).toHaveProperty('files', expect.arrayContaining(['docs/claude-oauth-parity.md']));
});

test('the default export is a Pi extension factory', () => {
  const factory: ExtensionFactory = extension;
  expect(factory).toBe(extension);
});

// Pi loads the package through jiti. Loading the checkout itself would register a second copy
// of src/index.ts under the same path and corrupt its coverage, so Pi discovers a copy of the
// files npm would publish. Pi aliases its own packages, so the copy needs no node_modules.
// Pi falls back to scanning subdirectories when the manifest names a missing file, so the test
// also requires the loaded path to be the one the manifest declares.
test('Pi loads the manifest extensions with one provider', async ({ onTestFinished }) => {
  const [cwd, agentDir, packageDir] = await Promise.all([mkdtemp(join(tmpdir(), 'pi-oauth-cwd-')), mkdtemp(join(tmpdir(), 'pi-oauth-agent-')), mkdtemp(join(tmpdir(), 'pi-oauth-package-'))]);
  onTestFinished(async () => {
    await Promise.all([cwd, agentDir, packageDir].map((dir) => rm(dir, { recursive: true, force: true })));
  });
  await Promise.all([cp(join(PACKAGE_DIR, 'package.json'), join(packageDir, 'package.json')), cp(join(PACKAGE_DIR, 'src'), join(packageDir, 'src'), { recursive: true })]);
  const { errors, extensions, runtime } = await discoverAndLoadExtensions([packageDir], cwd, agentDir);
  expect(errors).toStrictEqual([]);
  const declared = declaredExtensions(JSON.parse(await readFile(join(packageDir, 'package.json'), 'utf8')));
  expect(extensions.map((loaded) => loaded.path)).toStrictEqual(declared.map((entry) => resolve(packageDir, entry)));
  expect(extensions).toHaveLength(1);
  expect(extensions.map((loaded) => [...loaded.handlers.keys()])).toStrictEqual([[]]);
  const registrations = runtime.pendingNativeProviderRegistrations;
  expect(registrations).toHaveLength(1);
  const models = registrations.flatMap(({ provider }) => provider.getModels().map((model) => ({ provider: provider.id, owner: model.provider })));
  expect(models.length).toBeGreaterThan(0);
  expect(models.filter(({ provider, owner }) => provider !== owner)).toStrictEqual([]);
});

test('the provider id differs from the built-in anthropic id', async () => {
  const provider = captureProvider(extension);
  expect(provider.id).not.toBe('anthropic');
});

test('the login choice is labeled Claude subscription (Provider CLI)', () => {
  expect(captureProvider(extension).auth.oauth?.name).toBe('Claude subscription (Provider CLI)');
});

test('the login keeps the built-in subscription flag', () => {
  expect(captureProvider(extension).auth.oauth?.isSubscription).toBe(true);
});

test('the only interactive login method is OAuth', () => {
  const auth = captureProvider(extension).auth;
  expect(auth.oauth?.login).toBeTypeOf('function');
  expect(auth.apiKey?.login).toBeUndefined();
});

test('every model belongs to the registered provider', async () => {
  const provider = captureProvider(extension);
  expect(new Set(provider.getModels().map((model) => model.provider))).toStrictEqual(new Set([provider.id]));
});

test('the catalog matches the built-in anthropic catalog size', async () => {
  const provider = captureProvider(extension);
  const builtin = builtinProviders().find((candidate) => candidate.id === 'anthropic');
  expect(provider.getModels()).toHaveLength(builtin?.getModels().length ?? Number.NaN);
});

test('Models resolves claude-subscription/claude-sonnet-4-6', async () => {
  const models = createModels();
  models.setProvider(captureProvider(extension));
  expect(models.getModel('claude-subscription', 'claude-sonnet-4-6')).toMatchObject({ id: 'claude-sonnet-4-6', provider: 'claude-subscription' });
});
