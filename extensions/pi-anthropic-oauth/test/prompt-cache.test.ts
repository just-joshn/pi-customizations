import { expect } from 'vitest';
import { ask, readTool } from './support/context.ts';
import { test } from './support/fixtures.ts';
import { isRecord, soleRequest, systemBlocks, systemTexts } from './support/request-body.ts';
import { collect } from './support/run-stream.ts';

const ONE_HOUR = { type: 'ephemeral', ttl: '1h' };
const prompt = ask('hi', { systemPrompt: 'You are helpful.', tools: [readTool] });

function cacheMarkers(value: unknown): readonly unknown[] {
  if (Array.isArray(value)) return value.flatMap(cacheMarkers);
  if (!isRecord(value)) return [];
  return Object.entries(value).flatMap(([key, child]) => (key === 'cache_control' ? [child] : cacheMarkers(child)));
}

test('every cache breakpoint lasts one hour by default', async ({ models, model, server }) => {
  await collect(models.streamSimple(model, prompt));
  const markers = cacheMarkers(soleRequest(server).body);
  expect(markers.length).toBeGreaterThanOrEqual(3);
  expect(markers).toStrictEqual(markers.map(() => ONE_HOUR));
});

test('the non-simple stream also caches for one hour', async ({ models, model, server }) => {
  await collect(models.stream(model, prompt));
  expect(cacheMarkers(soleRequest(server).body)).toContainEqual(ONE_HOUR);
});

test('the billing block stays uncached', async ({ models, model, server }) => {
  await collect(models.streamSimple(model, prompt));
  expect(systemBlocks(soleRequest(server).body)[0]).not.toHaveProperty('cache_control');
});

test('an explicit request for no caching sends no cache breakpoints', async ({ models, model, server }) => {
  await collect(models.streamSimple(model, prompt, { cacheRetention: 'none' }));
  const { body } = soleRequest(server);
  expect(systemTexts(body)).toContain('You are helpful.');
  expect(cacheMarkers(body)).toHaveLength(0);
});

test('an explicit short retention is still lifted to one hour', async ({ models, model, server }) => {
  await collect(models.streamSimple(model, prompt, { cacheRetention: 'short' }));
  expect(cacheMarkers(soleRequest(server).body)).toContainEqual(ONE_HOUR);
});

test('every model declares the one-hour lifetime for both retention tiers', ({ provider }) => {
  const lifetimes = provider.getModels().map((model) => model.promptCache);
  expect(lifetimes.length).toBeGreaterThan(0);
  expect(lifetimes).toStrictEqual(lifetimes.map(() => ({ short: 3600, long: 3600 })));
});
