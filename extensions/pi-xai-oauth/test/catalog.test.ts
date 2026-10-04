import { getSupportedThinkingLevels } from '@earendil-works/pi-ai';
import { builtinProviders } from '@earendil-works/pi-ai/providers/all';
import { expect } from 'vitest';
import { BASELINE, catalogFailure, effortAliases, listPrices, meteredCost, parseCatalog, toPiModel } from '../src/catalog.ts';
import { test } from './network-guard.ts';
import { liveBody, liveEntry } from './support/catalog-body.ts';

const xai = builtinProviders().find((provider) => provider.id === 'xai');
const prices = listPrices(xai?.getModels() ?? []);

function parsedModels(body: unknown) {
  const parsed = parseCatalog(body);
  return parsed.kind === 'ok' ? parsed.models : [];
}

function baseline(id: string) {
  const model = BASELINE.find((candidate) => candidate.id === id);
  if (!model) throw new Error(`baseline has no ${id}`);
  return model;
}

test('the live-shaped body parses to the four served model ids', () => {
  expect(parsedModels(liveBody()).map((model) => model.id)).toStrictEqual(['grok-4.7', 'grok-4.7-build-fast', 'grok-4.6', 'grok-4.5']);
});

test('grok-4.5 parses to three efforts', () => {
  const grok45 = parsedModels(liveBody()).find((model) => model.id === 'grok-4.5');
  expect(grok45?.efforts).toStrictEqual(['low', 'medium', 'high']);
});

test('the parsed row carries the domain fields only', () => {
  expect(parsedModels({ data: [liveEntry('grok-4.7')] })).toStrictEqual([{ id: 'grok-4.7', name: 'grok-4.7', contextWindow: 256000, efforts: ['low', 'medium', 'high', 'xhigh'] }]);
});

test('a chat_completions row is skipped while its siblings remain', () => {
  const body = { data: [liveEntry('grok-4.7'), liveEntry('legacy', { api_backend: 'chat_completions' }), liveEntry('grok-4.6')] };
  expect(parsedModels(body).map((model) => model.id)).toStrictEqual(['grok-4.7', 'grok-4.6']);
});

test('a row without api_backend is kept', () => {
  expect(parsedModels({ data: [liveEntry('grok-4.7', { api_backend: undefined })] }).map((model) => model.id)).toStrictEqual(['grok-4.7']);
});

test('a row missing context_window is skipped', () => {
  const body = { data: [liveEntry('grok-4.7', { context_window: undefined }), liveEntry('grok-4.6')] };
  expect(parsedModels(body).map((model) => model.id)).toStrictEqual(['grok-4.6']);
});

test('unknown effort values are dropped, the rest are ordered', () => {
  const reasoning_efforts = [{ value: 'high' }, { value: 'max' }, { value: 'low' }];
  expect(parsedModels({ data: [liveEntry('grok-4.7', { reasoning_efforts })] })[0]?.efforts).toStrictEqual(['low', 'high']);
});

test('a row whose only effort is unknown is skipped', () => {
  const body = { data: [liveEntry('grok-4.7', { reasoning_efforts: [{ value: 'max' }] }), liveEntry('grok-4.6')] };
  expect(parsedModels(body).map((model) => model.id)).toStrictEqual(['grok-4.6']);
});

test('an id containing a slash is skipped', () => {
  expect(parsedModels({ data: [liveEntry('evil/model'), liveEntry('grok-4.6')] }).map((model) => model.id)).toStrictEqual(['grok-4.6']);
});

test('an id that is not a header-safe token is skipped', () => {
  expect(parsedModels({ data: [liveEntry('bad\r\nid'), liveEntry('grok-4.6')] }).map((model) => model.id)).toStrictEqual(['grok-4.6']);
});

test('a row with an empty name is skipped', () => {
  expect(parsedModels({ data: [liveEntry('grok-4.7', { name: '' }), liveEntry('grok-4.6')] }).map((model) => model.id)).toStrictEqual(['grok-4.6']);
});

test('an empty object is unreadable', () => {
  expect(parseCatalog({})).toStrictEqual({ kind: 'unreadable' });
});

test('null is unreadable', () => {
  expect(parseCatalog(null)).toStrictEqual({ kind: 'unreadable' });
});

test('a non-array data field is unreadable', () => {
  expect(parseCatalog({ data: 'nope' })).toStrictEqual({ kind: 'unreadable' });
});

test('an empty data array parses to no models', () => {
  expect(parseCatalog({ data: [] })).toStrictEqual({ kind: 'ok', models: [] });
});

test('grok-4.7 meters at 0.34 times the list price with tiers', () => {
  const cost = meteredCost('grok-4.7', prices);
  expect(cost.input).toBeCloseTo(0.68);
  expect(cost.output).toBeCloseTo(2.04);
  expect(cost.cacheRead).toBeCloseTo(0.17);
  expect(cost.cacheWrite).toBe(0);
  expect(cost.tiers?.map((tier) => tier.inputTokensAbove)).toStrictEqual([200000]);
  expect(cost.tiers?.[0]?.input).toBeCloseTo(1.36);
  expect(cost.tiers?.[0]?.output).toBeCloseTo(4.08);
  expect(cost.tiers?.[0]?.cacheRead).toBeCloseTo(0.34);
});

test('grok-4.7-build-fast meters at twice the grok-4.7 rate', () => {
  const cost = meteredCost('grok-4.7-build-fast', prices);
  expect(cost.input).toBeCloseTo(1.36);
  expect(cost.output).toBeCloseTo(4.08);
  expect(cost.cacheRead).toBeCloseTo(0.34);
});

test('grok-4.5 cached input meters at 0.102', () => {
  expect(meteredCost('grok-4.5', prices).cacheRead).toBeCloseTo(0.102);
});

test('a list price without tiers meters without tiers', () => {
  const untiered = new Map([['grok-x', { input: 1, output: 2, cacheRead: 0.5, cacheWrite: 0 }]]);
  expect(meteredCost('grok-x-build-fast', untiered)).toStrictEqual({ input: 0.68, output: 1.36, cacheRead: 0.34, cacheWrite: 0 });
});

test('an id with no list price costs nothing', () => {
  expect(meteredCost('grok-9', prices)).toStrictEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
});

test('metering leaves the list prices unchanged', () => {
  const before = JSON.stringify(prices.get('grok-4.7'));
  meteredCost('grok-4.7', prices);
  expect(JSON.stringify(prices.get('grok-4.7'))).toBe(before);
});

test('toPiModel maps the fast model to the proxy', () => {
  const model = toPiModel(baseline('grok-4.7-build-fast'), prices);
  expect({
    id: model.id,
    name: model.name,
    provider: model.provider,
    baseUrl: model.baseUrl,
    api: model.api,
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
    input: model.input,
    compat: model.compat,
    thinkingLevelMap: model.thinkingLevelMap,
  }).toStrictEqual({
    id: 'grok-4.7-build-fast',
    name: 'Grok 4.7 Fast',
    provider: 'grok-build',
    baseUrl: 'https://cli-chat-proxy.grok.com/v1',
    api: 'openai-responses',
    contextWindow: 256000,
    maxTokens: 256000,
    input: ['text', 'image'],
    compat: { supportsLongCacheRetention: false },
    thinkingLevelMap: { off: null, minimal: null, low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: null },
  });
});

test('toPiModel carries no per-model headers or limits', () => {
  const model = toPiModel(baseline('grok-4.7'), prices);
  expect([model.headers, model.samplingParams, model.inputLimits]).toStrictEqual([undefined, undefined, undefined]);
});

test('toPiModel disables xhigh for grok-4.5', () => {
  expect(toPiModel(baseline('grok-4.5'), prices).thinkingLevelMap?.xhigh).toBeNull();
});

test('the fast model supports four thinking levels', () => {
  expect(getSupportedThinkingLevels(toPiModel(baseline('grok-4.7-build-fast'), prices))).toStrictEqual(['low', 'medium', 'high', 'xhigh']);
});

test('effort aliases cover the fast model at each effort', () => {
  const aliases = effortAliases(BASELINE);
  expect(aliases.map((alias) => alias.id)).toStrictEqual(['grok-4.7-low-fast', 'grok-4.7-medium-fast', 'grok-4.7-high-fast', 'grok-4.7-xhigh-fast']);
  expect(aliases.map((alias) => alias.target)).toStrictEqual(Array(4).fill('grok-4.7-build-fast'));
  expect(aliases[3]).toStrictEqual({ id: 'grok-4.7-xhigh-fast', name: 'Grok 4.7 Fast (xhigh)', target: 'grok-4.7-build-fast', effort: 'xhigh', contextWindow: 256000 });
});

test('a model without the fast suffix gets no alias', () => {
  const aliases = effortAliases([baseline('grok-4.7'), baseline('grok-4.7-build-fast')]);
  expect(aliases.map((alias) => alias.target)).toStrictEqual(Array(4).fill('grok-4.7-build-fast'));
});

test('a 401 asks the user to log in again', () => {
  expect(catalogFailure(401).message).toBe('Grok Build rejected the session (HTTP 401). Run /login and choose Grok Build.');
});

test('a 403 asks the user to log in again', () => {
  expect(catalogFailure(403).message).toBe('Grok Build rejected the session (HTTP 403). Run /login and choose Grok Build.');
});

test('a 503 reports the model list failure', () => {
  expect(catalogFailure(503).message).toBe('Grok Build model list failed (HTTP 503).');
});
