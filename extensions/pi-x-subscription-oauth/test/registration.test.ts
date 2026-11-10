import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { discoverAndLoadExtensions, type ExtensionFactory } from '@earendil-works/pi-coding-agent';
import { expect } from 'vitest';
import extension from '../src/index.ts';
import { test } from './network-guard.ts';
import { declaredExtensions } from './support/package-manifest.ts';

const PACKAGE_DIR = fileURLToPath(new URL('..', import.meta.url));

test('the default export is a Pi extension factory', () => {
  const factory: ExtensionFactory = extension;
  expect(typeof factory).toBe('function');
});

// Pi loads the package through jiti. Loading the checkout itself would register a second copy
// of src/index.ts under the same path and corrupt its coverage, so Pi discovers a copy of the
// files npm would publish. Pi falls back to scanning subdirectories when the manifest names a
// missing file, so the test also requires the loaded path to be the one the manifest declares.
test('Pi loads the manifest extension with grok-build and cursor', async ({ onTestFinished }) => {
  const [cwd, agentDir, packageDir] = await Promise.all([mkdtemp(join(tmpdir(), 'pi-x-subscription-oauth-cwd-')), mkdtemp(join(tmpdir(), 'pi-x-subscription-oauth-agent-')), mkdtemp(join(tmpdir(), 'pi-x-subscription-oauth-package-'))]);
  onTestFinished(async () => {
    await Promise.all([cwd, agentDir, packageDir].map((dir) => rm(dir, { recursive: true, force: true })));
  });
  await Promise.all([cp(join(PACKAGE_DIR, 'package.json'), join(packageDir, 'package.json')), cp(join(PACKAGE_DIR, 'src'), join(packageDir, 'src'), { recursive: true })]);
  const { errors, extensions, runtime } = await discoverAndLoadExtensions([packageDir], cwd, agentDir);
  expect(errors).toStrictEqual([]);
  const declared = declaredExtensions(JSON.parse(await readFile(join(packageDir, 'package.json'), 'utf8')));
  expect(extensions.map((loaded) => loaded.path)).toStrictEqual(declared.map((entry) => resolve(packageDir, entry)));
  expect(extensions).toHaveLength(1);
  expect([...(extensions[0]?.commands.keys() ?? [])]).toStrictEqual(['usage']);
  const registrations = runtime.pendingNativeProviderRegistrations;
  expect(registrations.map(({ provider }) => provider.id).sort()).toStrictEqual(['cursor', 'grok-build']);
  const models = registrations.flatMap(({ provider }) => provider.getModels().map((model) => ({ id: model.id, provider: provider.id, owner: model.provider })));
  const grok = models.filter((model) => model.provider === 'grok-build');
  const cursor = models.filter((model) => model.provider === 'cursor');
  expect(grok.map((model) => model.id)).toStrictEqual(['grok-4.7', 'grok-4.7-build-fast', 'grok-4.6', 'grok-4.5']);
  expect(grok.filter((model) => model.owner !== 'grok-build')).toStrictEqual([]);
  expect(cursor.map((model) => model.id)).toContain('composer-2.5');
  expect(cursor.filter((model) => model.owner !== 'cursor')).toStrictEqual([]);
});
