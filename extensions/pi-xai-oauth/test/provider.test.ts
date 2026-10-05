import { createModels, getSupportedThinkingLevels, type Model, type Provider } from '@earendil-works/pi-ai';
import type { ExtensionVirtualModel } from '@earendil-works/pi-coding-agent';
import { expect } from 'vitest';
import { BASELINE, listPrices, toPiModel } from '../src/catalog.ts';
import extension, { createGrokBuildProvider } from '../src/index.ts';
import { test } from './network-guard.ts';
import { builtinXai } from './support/builtin-xai.ts';
import { contextFinding, onlyProvider, register } from './support/fake-pi.ts';

const registrations = register(extension);
const provider = onlyProvider(registrations);
const xai = builtinXai();

function fastModel(): Model<'openai-responses'> {
  const fast = BASELINE.find((model) => model.id === 'grok-4.7-build-fast');
  if (!fast) throw new Error('baseline has no grok-4.7-build-fast');
  return toPiModel(fast, listPrices(xai.getModels()));
}

function alias(id: string): ExtensionVirtualModel {
  const found = registrations.virtualModels.find((model) => model.id === id);
  if (!found) throw new Error(`no virtual model ${id}`);
  return found;
}

function request(thinkingLevel: 'low' | 'xhigh') {
  return { model: fastModel(), thinkingLevel, reason: 'user' as const, messages: [] };
}

test('the registered provider is Grok Build', () => {
  expect([provider.id, provider.name]).toStrictEqual(['grok-build', 'Grok Build']);
});

test('the only login method is OAuth', () => {
  expect(Object.keys(provider.auth)).toStrictEqual(['oauth']);
});

test('the login is labeled as a Grok Build subscription', () => {
  expect(provider.auth.oauth?.name).toBe('Grok Build (SuperGrok or X Premium)');
  expect(provider.auth.oauth?.isSubscription).toBe(true);
  expect(provider.auth.oauth?.loginLabel).toBe('Sign in with SuperGrok or X Premium');
});

test('the baseline lists the four Grok Build models', () => {
  expect(provider.getModels().map((model) => model.id)).toStrictEqual(['grok-4.7', 'grok-4.7-build-fast', 'grok-4.6', 'grok-4.5']);
});

test('every model belongs to the Grok Build provider', () => {
  expect(new Set(provider.getModels().map((model) => model.provider))).toStrictEqual(new Set(['grok-build']));
});

test('Models resolves grok-build/grok-4.7-build-fast', () => {
  const models = createModels();
  models.setProvider(provider);
  expect(models.getModel('grok-build', 'grok-4.7-build-fast')).toMatchObject({ id: 'grok-4.7-build-fast', provider: 'grok-build' });
});

test('four effort aliases are registered under Grok Build', () => {
  expect(registrations.virtualModels.map((model) => [model.provider, model.id])).toStrictEqual([
    ['grok-build', 'grok-4.7-low-fast'],
    ['grok-build', 'grok-4.7-medium-fast'],
    ['grok-build', 'grok-4.7-high-fast'],
    ['grok-build', 'grok-4.7-xhigh-fast'],
  ]);
});

test('the xhigh alias offers only xhigh', () => {
  const xhigh = alias('grok-4.7-xhigh-fast');
  expect([xhigh.name, xhigh.thinkingLevels, xhigh.contextWindow, xhigh.maxTokens]).toStrictEqual(['Grok 4.7 Fast (xhigh)', ['xhigh'], 256000, 256000]);
});

test('the xhigh route returns the physical model at xhigh', async () => {
  const model = fastModel();
  const route = await alias('grok-4.7-xhigh-fast').route(
    request('low'),
    contextFinding((id, modelId) => (id === 'grok-build' && modelId === 'grok-4.7-build-fast' ? model : undefined)),
  );
  expect(route).toStrictEqual({ model, thinkingLevel: 'xhigh' });
});

test('the route ignores the requested thinking level', async () => {
  const model = fastModel();
  const route = await alias('grok-4.7-low-fast').route(
    request('xhigh'),
    contextFinding(() => model),
  );
  expect(route.thinkingLevel).toBe('low');
});

test('the route reports a model the catalog no longer lists', () => {
  const { route } = alias('grok-4.7-xhigh-fast');
  expect(() =>
    route(
      request('xhigh'),
      contextFinding(() => undefined),
    ),
  ).toThrow('Grok Build no longer lists grok-4.7-build-fast.');
});

test('the route refuses to clamp to a lesser effort', () => {
  const model = fastModel();
  const withoutXhigh = { ...model, thinkingLevelMap: { ...model.thinkingLevelMap, xhigh: null } };
  expect(getSupportedThinkingLevels(withoutXhigh)).toStrictEqual(['low', 'medium', 'high']);
  const { route } = alias('grok-4.7-xhigh-fast');
  expect(() =>
    route(
      request('xhigh'),
      contextFinding(() => withoutXhigh),
    ),
  ).toThrow('grok-4.7-build-fast no longer offers xhigh reasoning. Supported: low, medium, high.');
});

test('a provider without OAuth is rejected', () => {
  const withoutOauth: Provider = { ...xai, auth: {} };
  expect(() => createGrokBuildProvider(withoutOauth)).toThrow("Pi's built-in xai provider with SuperGrok / X Premium OAuth is not available.");
});
