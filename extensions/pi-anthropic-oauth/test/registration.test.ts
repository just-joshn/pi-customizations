import { createModels } from '@earendil-works/pi-ai';
import { builtinProviders } from '@earendil-works/pi-ai/providers/all';
import { expect, test } from 'vitest';
import extension from '../src/index.ts';
import { loadExtension, loadProvider } from './support/load-extension.ts';

test('loading registers exactly one native provider', async () => {
  const { registrations } = await loadExtension(extension);
  expect(registrations).toHaveLength(1);
});

test('the loader accepts the extension without errors', async () => {
  await expect(loadExtension(extension)).resolves.toMatchObject({ registrations: [{ provider: { id: expect.any(String) } }] });
});

test('the provider id differs from the built-in anthropic id', async () => {
  const provider = await loadProvider(extension);
  expect(provider.id).not.toBe('anthropic');
});

test('every model belongs to the registered provider', async () => {
  const provider = await loadProvider(extension);
  expect(new Set(provider.getModels().map((model) => model.provider))).toStrictEqual(new Set([provider.id]));
});

test('the catalog matches the built-in anthropic catalog size', async () => {
  const provider = await loadProvider(extension);
  const builtin = builtinProviders().find((candidate) => candidate.id === 'anthropic');
  expect(provider.getModels()).toHaveLength(builtin?.getModels().length ?? Number.NaN);
});

test('Models resolves claude-subscription/claude-sonnet-4-6', async () => {
  const models = createModels();
  models.setProvider(await loadProvider(extension));
  expect(models.getModel('claude-subscription', 'claude-sonnet-4-6')).toMatchObject({ id: 'claude-sonnet-4-6', provider: 'claude-subscription' });
});
