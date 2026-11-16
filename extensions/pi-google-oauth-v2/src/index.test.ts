import { readdirSync, readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { fileURLToPath } from 'node:url';

import { createModels, InMemoryCredentialStore, InMemoryModelsStore, type Provider } from '@earendil-works/pi-ai';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { afterEach, expect, test, vi } from 'vitest';
import { CODE_ASSIST_BASE_URL, PROVIDER_ID } from './constants.ts';
import extension from './index.ts';
import type { Catalog } from './models.ts';

const accountCatalog: Catalog = {
  models: {
    'gemini-4-hydrogen-medium': { displayName: 'Gemini 4 Hydrogen (Medium)', supportsThinking: true, maxTokens: 1048576, maxOutputTokens: 262144 },
    'gemini-3.8-flash-medium': { displayName: 'Gemini 3.8 Flash (Medium)', supportsThinking: true, maxTokens: 1048576, maxOutputTokens: 65536 },
  },
  agentModelSorts: [{ groups: [{ modelIds: ['gemini-4-hydrogen-medium', 'gemini-3.8-flash-medium'] }] }],
};
const accountModelIds = ['gemini-3.8-flash', 'gemini-4-hydrogen'];
const credential = { type: 'oauth', access: 'synthetic-access', refresh: 'synthetic-refresh', expires: Date.now() + 3_600_000, projectId: 'synthetic-project' } as const;

afterEach(() => vi.unstubAllGlobals());

function register(): Provider[] {
  const registered: Provider[] = [];
  const pi = { registerProvider: (provider: Provider) => registered.push(provider) } as unknown as ExtensionAPI;
  extension(pi);
  return registered;
}

async function catalogRuntime(modelsStore = new InMemoryModelsStore()) {
  const credentials = new InMemoryCredentialStore();
  await credentials.modify(PROVIDER_ID, async () => credential);
  const models = createModels({ credentials, modelsStore });
  const [provider] = register();
  if (!provider) throw new Error('extension registered no provider');
  models.setProvider(provider);
  return { models, provider, modelsStore };
}

test('an authenticated catalog replaces baseline families in native model selection', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json(accountCatalog)),
  );
  const { models } = await catalogRuntime();

  const result = await models.refresh({ allowNetwork: true });

  expect(result.errors.size).toBe(0);
  expect(
    models
      .getModels(PROVIDER_ID)
      .map((model) => model.id)
      .sort(),
  ).toEqual(accountModelIds);
  expect(models.getModel(PROVIDER_ID, 'gemini-4-argon')).toBeUndefined();
});

test('restores an accepted account catalog offline without baseline families', async () => {
  const fetchImpl = vi.fn(async () => Response.json(accountCatalog));
  vi.stubGlobal('fetch', fetchImpl);
  const { models, modelsStore } = await catalogRuntime();
  expect((await models.refresh({ allowNetwork: true })).errors.size).toBe(0);
  const restored = await catalogRuntime(modelsStore);
  fetchImpl.mockClear();

  const result = await restored.models.refresh({ allowNetwork: false });

  expect(result.errors.size).toBe(0);
  expect(fetchImpl).not.toHaveBeenCalled();
  expect(
    restored.models
      .getModels(PROVIDER_ID)
      .map((model) => model.id)
      .sort(),
  ).toEqual(accountModelIds);
});

test('a failed catalog request retains the last accepted catalog', async () => {
  const fetchImpl = vi.fn(async () => Response.json(accountCatalog));
  vi.stubGlobal('fetch', fetchImpl);
  const { models, modelsStore } = await catalogRuntime();
  expect((await models.refresh({ allowNetwork: true })).errors.size).toBe(0);
  const knownModels = models.getModels(PROVIDER_ID);
  const stored = await modelsStore.read(PROVIDER_ID);
  fetchImpl.mockRejectedValue(new Error('synthetic network failure'));

  const result = await models.refresh({ allowNetwork: true, force: true });

  expect(result.errors.get(PROVIDER_ID)?.message).toContain('synthetic network failure');
  expect(models.getModels(PROVIDER_ID)).toEqual(knownModels);
  expect(await modelsStore.read(PROVIDER_ID)).toEqual(stored);
});

test('a rejected stored catalog publication retains the baseline and skips network access', async () => {
  const fetchImpl = vi.fn(async () => Response.json(accountCatalog));
  vi.stubGlobal('fetch', fetchImpl);
  const { models, modelsStore } = await catalogRuntime();
  expect((await models.refresh({ allowNetwork: true })).errors.size).toBe(0);
  const stored = await modelsStore.read(PROVIDER_ID);
  if (!stored) throw new Error('account catalog was not persisted');
  const restored = await catalogRuntime(modelsStore);
  const before = restored.provider.getModels();
  const publish = vi.fn(async () => false);
  fetchImpl.mockClear();
  if (!restored.provider.refreshModels) throw new Error('provider cannot refresh models');

  await restored.provider.refreshModels({ stored, credential, allowNetwork: true, signal: new AbortController().signal, publish });

  expect(publish).toHaveBeenCalledOnce();
  expect(fetchImpl).not.toHaveBeenCalled();
  expect(restored.provider.getModels()).toEqual(before);
});

test('a rejected catalog publication leaves registered provider state unchanged', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json(accountCatalog)),
  );
  const { models, provider } = await catalogRuntime();
  const before = models.getModels(PROVIDER_ID);
  const publish = vi.fn(async () => false);
  if (!provider.refreshModels) throw new Error('provider cannot refresh models');

  await provider.refreshModels({ credential, allowNetwork: true, signal: new AbortController().signal, publish });

  expect(publish).toHaveBeenCalledOnce();
  expect(models.getModels(PROVIDER_ID)).toEqual(before);
});

test('an aborted catalog request leaves registered provider state unchanged', async () => {
  const controller = new AbortController();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      controller.abort();
      return Response.json(accountCatalog);
    }),
  );
  const { models, provider } = await catalogRuntime();
  const before = models.getModels(PROVIDER_ID);
  const publish = vi.fn(async () => false);
  if (!provider.refreshModels) throw new Error('provider cannot refresh models');

  await provider.refreshModels({ credential, allowNetwork: true, signal: controller.signal, publish });

  expect(publish).not.toHaveBeenCalled();
  expect(models.getModels(PROVIDER_ID)).toEqual(before);
});

test('registers exactly one native provider for the Code Assist api', () => {
  const [provider, ...rest] = register();
  expect(rest).toEqual([]);
  expect(provider).toMatchObject({ id: PROVIDER_ID, baseUrl: CODE_ASSIST_BASE_URL, auth: { oauth: { isSubscription: true } } });
  expect(provider?.getModels().map((model) => model.id)).toEqual(['gemini-4-argon', 'gemini-3.8-flash']);
  expect(provider?.refreshModels).toBeTypeOf('function');
});

test('starts no listener, timer, or request while loading', () => {
  const fetchSpy = vi.fn();
  vi.stubGlobal('fetch', fetchSpy);
  const before = process.getActiveResourcesInfo();
  register();
  expect(process.getActiveResourcesInfo()).toEqual(before);
  expect(fetchSpy).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

test('production sources import only Pi-supplied modules and node builtins', () => {
  const sourceDirectory = fileURLToPath(new URL('.', import.meta.url));
  const files = readdirSync(sourceDirectory).filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'));
  const allowed = new Set(['@earendil-works/pi-ai', '@earendil-works/pi-ai/providers/all', '@earendil-works/pi-coding-agent']);
  const specifiers = files.flatMap((name) => [...readFileSync(new URL(name, import.meta.url), 'utf8').matchAll(/from '([^']+)'/g)].map((match) => match[1] ?? ''));
  const rejected = specifiers.filter((specifier) => !(specifier.startsWith('./') || specifier.startsWith('node:') || builtinModules.includes(specifier) || allowed.has(specifier)));
  expect(files.length).toBeGreaterThan(5);
  expect(rejected).toEqual([]);
});

test('the package exports only its entry point', () => {
  const manifest: { exports: unknown } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  expect(manifest.exports).toEqual({ '.': './src/index.ts' });
});
