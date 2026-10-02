import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { discoverAndLoadExtensions, type ExtensionFactory } from '@earendil-works/pi-coding-agent';
import { expect, test } from 'vitest';
import extension from '../src/index.ts';
import { declaredExtensions } from './support/package-manifest.ts';

const PACKAGE_DIR = fileURLToPath(new URL('..', import.meta.url));

test('the default export is a Pi extension factory', () => {
  const factory: ExtensionFactory = extension;
  expect(factory).toBe(extension);
});

// Pi loads the package through jiti. Loading the checkout itself would register a second copy
// of src/index.ts under the same path and corrupt its coverage, so Pi discovers a copy of the
// files npm would publish. Pi falls back to scanning subdirectories when the manifest names a
// missing file, so the test also requires the loaded path to be the one the manifest declares.
test('Pi loads the manifest extension with one native provider', async ({ onTestFinished }) => {
  const [cwd, agentDir, packageDir] = await Promise.all(['cwd', 'agent', 'package'].map((name) => mkdtemp(join(tmpdir(), `pi-xai-${name}-`))));
  onTestFinished(async () => {
    await Promise.all([cwd, agentDir, packageDir].map((dir) => rm(dir, { recursive: true, force: true })));
  });
  await Promise.all([cp(join(PACKAGE_DIR, 'package.json'), join(packageDir, 'package.json')), cp(join(PACKAGE_DIR, 'src'), join(packageDir, 'src'), { recursive: true })]);
  const { errors, extensions, runtime } = await discoverAndLoadExtensions([packageDir], cwd, agentDir);
  expect(errors).toStrictEqual([]);
  const declared = declaredExtensions(JSON.parse(await readFile(join(packageDir, 'package.json'), 'utf8')));
  expect(extensions.map((loaded) => loaded.path)).toStrictEqual(declared.map((entry) => resolve(packageDir, entry)));
  expect(extensions).toHaveLength(1);
  const registrations = runtime.pendingNativeProviderRegistrations;
  expect(registrations).toHaveLength(1);
  const models = registrations.flatMap(({ provider }) => provider.getModels().map((model) => ({ provider: provider.id, owner: model.provider })));
  expect(models).toHaveLength(4);
  expect(models.filter(({ provider, owner }) => provider !== 'grok-build' || owner !== 'grok-build')).toStrictEqual([]);
});
