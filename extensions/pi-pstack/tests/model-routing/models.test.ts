import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Api, Model, ThinkingLevelMap } from '@earendil-works/pi-ai';
import { afterEach, expect, test } from 'vitest';

import { convertModelRule, migrateModelConfig } from '../../adapters/model-config.js';
import { BUDGET_EFFORT, parseModelsConfig, resolveRole, type ModelsConfig, type ResolvedModel } from '../../src/models.js';

const parent: ResolvedModel = { provider: 'openai', id: 'gpt-6.1-sol', thinkingLevel: 'low' };
function model(provider = parent.provider, id = parent.id, thinkingLevelMap?: ThinkingLevelMap): Model<Api> {
  return { provider, id, name: id, api: 'openai-responses', baseUrl: 'https://example.invalid', reasoning: true,
    input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1000, maxTokens: 100,
    ...(thinkingLevelMap ? { thinkingLevelMap } : {}),
  };
}
function config(roles: ModelsConfig['roles'], budget: ModelsConfig['budget'] = 'large'): ModelsConfig {
  return parseModelsConfig({ schemaVersion: 1, budget, roles });
}
const registry = { getAvailable: () => [model(), model('claude-subscription', 'claude-opus-5-5')] };
const temporary: string[] = [];
afterEach(() => { for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true }); });

test('reports a missing provider without returning a nonexistent model', () => {
  const result = resolveRole('bug-fix', registry, parent, config({ 'bug-fix': 'missing/gpt-6.1-sol:high' }));
  expect(result.models).toEqual([]);
  expect(result.limitations).toEqual(['missing/gpt-6.1-sol:high is unavailable at or below high; role needs a model choice']);
});

test('falls down the supported effort ladder', () => {
  const result = resolveRole('bug-fix', registry, parent, config({ 'bug-fix': 'openai/gpt-6.1-sol:max' }));
  expect(result.models).toEqual([{ ...parent, thinkingLevel: 'high' }]);
  expect(result.limitations).toEqual(['openai/gpt-6.1-sol:max resolved to openai/gpt-6.1-sol:high (gpt-6.1-sol supports off, minimal, low, medium, high, not max)']);
});

test('a model without the requested level keeps the role at its nearest level instead of handing it to a family sibling', () => {
  // glm-5.3-flash has no off; glm-4.7 does. The sibling must not win just because it matches the level.
  const flash = model('zai', 'glm-5.3-flash', { off: null, minimal: null, low: 'low', medium: null, high: 'high', max: 'max' });
  const sibling = model('zai', 'glm-4.7');
  const zai = { getAvailable: () => [sibling, flash] };
  const off = resolveRole('bug-fix', zai, parent, config({ 'bug-fix': 'zai/glm-5.3-flash:off' }));
  expect(off.models).toEqual([{ provider: 'zai', id: 'glm-5.3-flash', thinkingLevel: 'low' }]);
  expect(off.limitations[0]).toMatch(/glm-5\.3-flash supports low, high, max, not off/);
  const budget = resolveRole('bug-fix', zai, parent, config({ 'bug-fix': 'zai/glm-5.3-flash' }));
  expect(budget.models).toEqual([{ provider: 'zai', id: 'glm-5.3-flash', thinkingLevel: 'high' }]);
});

test('a family sibling stands in only when the requested model is unavailable, and the reason names it', () => {
  const sibling = model('zai', 'glm-4.7');
  const result = resolveRole('bug-fix', { getAvailable: () => [sibling] }, parent, config({ 'bug-fix': 'zai/glm-5.3-flash:high' }));
  expect(result.models).toEqual([{ provider: 'zai', id: 'glm-4.7', thinkingLevel: 'high' }]);
  expect(result.limitations).toEqual(['zai/glm-5.3-flash:high resolved to zai/glm-4.7:high (zai/glm-5.3-flash is not available)']);
});

test('uses another listed same-family model when the selected id is absent', () => {
  const result = resolveRole('bug-fix', registry, parent, config({ 'bug-fix': 'openai/gpt-absent:high' }));
  expect(result.models).toEqual([{ ...parent, thinkingLevel: 'high' }]);
  expect(result.limitations).toHaveLength(1);
});

test.for(['inherit-parent', 'auto'])('%s preserves the parent effort instead of the budget', (alias) => {
  expect(resolveRole('bug-fix', registry, parent, config({ 'bug-fix': alias }, 'unlimited'))).toEqual({ models: [parent], limitations: [] });
});

test.for(Object.entries(BUDGET_EFFORT))('budget %s selects %s when supported', ([budget, thinkingLevel]) => {
  const available = { getAvailable: () => [model(undefined, undefined, { xhigh: 'xhigh', max: 'max' })] };
  const result = resolveRole('bug-fix', available, parent, config({ 'bug-fix': 'openai/gpt-6.1-sol' }, budget as ModelsConfig['budget']));
  expect(result.models).toEqual([{ ...parent, thinkingLevel }]);
});

test('preserves panel cardinality but reports the missing family', () => {
  const result = resolveRole('architect runners', registry, parent, config({ 'architect runners': ['auto', 'inherit-parent'] }));
  expect(result.models).toEqual([parent, parent]);
  expect(result.limitations).toEqual(['panel has 2 entries but 1 family']);
});

test('cross-judge skips aliases and the parent family and takes one independent choice', () => {
  const result = resolveRole('arena cross-judge pool', registry, parent, config({ 'arena cross-judge pool': ['auto', 'openai/gpt-6.1-sol:low', 'claude-subscription/claude-opus-5-5:medium'] }));
  expect(result).toEqual({ models: [{ provider: 'claude-subscription', id: 'claude-opus-5-5', thinkingLevel: 'medium' }], limitations: [] });
});

test('cross-judge reports an unavailable independent family', () => {
  expect(resolveRole('arena cross-judge pool', { getAvailable: () => [model()] }, parent, config({ 'arena cross-judge pool': ['auto'] }))).toEqual({ models: [], limitations: ['No independent cross-judge family is available'] });
});

test('cross-judge falls back to the listed independent skill default', () => {
  const result = resolveRole('arena cross-judge pool', registry, parent, config({ 'arena cross-judge pool': ['auto'] }, 'medium'));
  expect(result.models).toEqual([{ provider: 'claude-subscription', id: 'claude-opus-5-5', thinkingLevel: 'high' }]);
});

test('does not count two Claude tiers as independent families', () => {
  const available = { getAvailable: () => [model('claude-subscription', 'claude-opus-5-5'), model('claude-subscription', 'claude-sonnet-5-5')] };
  const result = resolveRole('architect runners', available, parent, config({ 'architect runners': ['claude-subscription/claude-opus-5-5:high', 'claude-subscription/claude-sonnet-5-5:high'] }));
  expect(result.models).toHaveLength(2);
  expect(result.limitations).toContain('panel has 2 entries but 1 family');
});

test('missing role configuration selects its available skill default', () => {
  expect(resolveRole('judgment and prose', registry, parent, config({}, 'medium'))).toEqual({ models: [{ provider: 'claude-subscription', id: 'claude-opus-5-5', thinkingLevel: 'high' }], limitations: [] });
});

test('does not fall below low when a model has no supported effort on the source ladder', () => {
  const available = { getAvailable: () => [{ ...model(), reasoning: false }] };
  const result = resolveRole('bug-fix', available, parent, config({ 'bug-fix': 'openai/gpt-6.1-sol:high' }));
  expect(result.models).toEqual([]);
  expect(result.limitations).toHaveLength(1);
});

test('rejects an unknown role', () => {
  expect(() => resolveRole('how critics', registry, parent, config({}))).toThrow('Unknown pstack model role');
});

test.for([
  { schemaVersion: 2, budget: 'large', roles: {} },
  { schemaVersion: 1, budget: 'enormous', roles: {} },
  { schemaVersion: 1, budget: 'large', roles: { retired: 'auto' } },
  { schemaVersion: 1, budget: 'large', roles: { 'bug-fix': ['auto'] } },
  { schemaVersion: 1, budget: 'large', roles: { 'architect runners': 'auto' } },
  { schemaVersion: 1, budget: 'large', roles: { 'bug-fix': 'openai/gpt:impossible' } },
])('rejects invalid configuration %#', (input) => {
  expect(() => parseModelsConfig(input)).toThrow(/Invalid/);
});

test('migration round trips all real current rule choices and preserves its budget line', () => {
  const source = readFileSync(new URL('./fixtures/pstack-models.md', import.meta.url), 'utf8');
  const converted = convertModelRule(`${source}\nhow critics: auto\n`);
  expect(parseModelsConfig(JSON.stringify(converted))).toEqual(converted);
  expect(Object.keys(converted.roles)).toHaveLength(17);
  expect(converted.budgetLine).toBe(source.split('\n')[2]);
  expect(converted.budget).toBe('large');
  for (const [role, value] of Object.entries(converted.roles)) {
    expect(source.split('\n')).toContain(`${role}: ${Array.isArray(value) ? value.join(', ') : value}`);
  }
});

test('migration does not replace an existing JSON configuration on rerun', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pstack-models-'));
  temporary.push(dir);
  const source = join(dir, 'pstack-models.md');
  const destination = join(dir, 'models.json');
  writeFileSync(source, '# budget: small (medium)\nbug-fix: auto\n');
  const first = migrateModelConfig(source, destination);
  const bytes = readFileSync(destination, 'utf8');
  writeFileSync(source, '# budget: unlimited (max)\nbug-fix: inherit-parent\n');
  expect(migrateModelConfig(source, destination)).toEqual(first);
  expect(readFileSync(destination, 'utf8')).toBe(bytes);
});
