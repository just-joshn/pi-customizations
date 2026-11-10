import { readFileSync } from 'node:fs';

import type { ExtensionCommandContext } from '@earendil-works/pi-coding-agent';
import { expect, vi } from 'vitest';
import { PROXY_BASE_URL } from '../src/catalog.ts';
import { GROK_CLIENT_VERSION } from '../src/request.ts';
import { createUsageCommand, fetchPlanUsage, formatPlanUsage, type PlanUsage, parseBillingCredits } from '../src/usage.ts';
import { test } from './network-guard.ts';

const billing: unknown = JSON.parse(readFileSync(new URL('./fixtures/billing-credits.json', import.meta.url), 'utf8'));
const NOW = Date.parse('2026-11-09T10:21:35.220Z');

function parsedUsage(body: unknown = billing): PlanUsage {
  const parsed = parseBillingCredits(body);
  if (parsed.kind !== 'ok') throw new Error('expected a readable billing body');
  return parsed.usage;
}

test('the credits fixture parses the weekly pool, product split, prepaid, and unified flag', () => {
  expect(parsedUsage()).toStrictEqual({
    usedPercent: 17,
    period: {
      type: 'USAGE_PERIOD_TYPE_WEEKLY',
      start: '2026-11-08T10:21:35.220+00:00',
      end: '2026-11-15T10:21:35.220+00:00',
    },
    products: [
      { product: 'GrokBuild', usagePercent: 15 },
      { product: 'Cursor', usagePercent: 2 },
    ],
    prepaid: 0,
    unified: true,
  });
});

test('the formatted panel shows used, remaining, reset, products, prepaid, and unified', () => {
  const usage = parsedUsage();
  const text = formatPlanUsage(usage, NOW);
  expect(usage.usedPercent).toBe(17);
  expect(text).toBe(['Weekly 2026-11-08T10:21:35.220+00:00 to 2026-11-15T10:21:35.220+00:00: 17% used, 83% left, resets in 6d 0h 0m', 'GrokBuild: 15%', 'Cursor: 2%', 'Prepaid: 0', 'Unified: yes'].join('\n'));
  expect(text).toContain(`${100 - usage.usedPercent}% left`);
});

test('a missing currentPeriod falls back to billingPeriodStart and billingPeriodEnd', () => {
  const usage = parsedUsage({
    config: {
      creditUsagePercent: 10,
      billingPeriodStart: '2026-11-01T00:00:00Z',
      billingPeriodEnd: '2026-11-08T00:00:00Z',
    },
  });
  expect(usage.period).toStrictEqual({ start: '2026-11-01T00:00:00Z', end: '2026-11-08T00:00:00Z' });
  expect(formatPlanUsage(usage, Date.parse('2026-11-01T00:00:00Z'))).toBe(['Plan 2026-11-01T00:00:00Z to 2026-11-08T00:00:00Z: 10% used, 90% left, resets in 7d 0h 0m', 'Products: none', 'Prepaid: unknown', 'Unified: unknown'].join('\n'));
});

test('currentPeriod bounds win over the billingPeriod fallback', () => {
  const usage = parsedUsage({
    config: {
      creditUsagePercent: 1,
      currentPeriod: { type: 'USAGE_PERIOD_TYPE_WEEKLY', end: '2026-11-08T02:30:00Z' },
      billingPeriodStart: '2026-11-01T00:00:00Z',
      billingPeriodEnd: '2099-01-01T00:00:00Z',
    },
  });
  expect(usage.period).toStrictEqual({ type: 'USAGE_PERIOD_TYPE_WEEKLY', start: '2026-11-01T00:00:00Z', end: '2026-11-08T02:30:00Z' });
  expect(formatPlanUsage(usage, Date.parse('2026-11-08T00:00:00Z'))).toContain('resets in 2h 30m');
});

test('a start without an end is kept and the reset is omitted', () => {
  const usage = parsedUsage({ config: { creditUsagePercent: 4, currentPeriod: { start: '2026-11-01T00:00:00Z' } } });
  expect(usage.period).toStrictEqual({ start: '2026-11-01T00:00:00Z' });
  expect(formatPlanUsage(usage, NOW)).toBe(['Plan: 4% used, 96% left', 'Products: none', 'Prepaid: unknown', 'Unified: unknown'].join('\n'));
});

test('an end with no start still names the reset', () => {
  const usage = parsedUsage({ config: { creditUsagePercent: 0, currentPeriod: { end: '2026-11-08T00:40:00Z' } } });
  expect(formatPlanUsage(usage, Date.parse('2026-11-08T00:00:00Z'))).toContain('Plan ending 2026-11-08T00:40:00Z: 0% used, 100% left, resets in 40m');
});

test('a tenth of a percent and a non-weekly type are printed as given', () => {
  const text = formatPlanUsage(
    {
      usedPercent: 17.25,
      period: { type: 'USAGE_PERIOD_TYPE_MONTHLY' },
      products: [{ product: 'GrokBuild', usagePercent: 17.24 }],
      prepaid: 3,
      unified: false,
    },
    NOW,
  );
  expect(text).toBe(['USAGE_PERIOD_TYPE_MONTHLY: 17.3% used, 82.7% left', 'GrokBuild: 17.2%', 'Prepaid: 3', 'Unified: no'].join('\n'));
});

test('0.05% used prints 0.1% used and 99.9% left', () => {
  const text = formatPlanUsage({ usedPercent: 0.05, period: { type: 'USAGE_PERIOD_TYPE_WEEKLY' }, products: [] }, NOW);
  expect(text).toBe(['Weekly: 0.1% used, 99.9% left', 'Products: none', 'Prepaid: unknown', 'Unified: unknown'].join('\n'));
});

test('an unreadable end is omitted and a bad product row is skipped', () => {
  const usage = parsedUsage({
    config: {
      creditUsagePercent: 100,
      currentPeriod: { type: 'USAGE_PERIOD_TYPE_WEEKLY', end: 'not-a-date' },
      productUsage: [{ product: 'GrokBuild', usagePercent: 15 }, { product: '', usagePercent: 1 }, { usagePercent: 4 }, { product: 'Cursor', usagePercent: 101 }, 'nope'],
      isUnifiedBillingUser: false,
    },
  });
  expect(usage.products).toStrictEqual([{ product: 'GrokBuild', usagePercent: 15 }]);
  expect(formatPlanUsage(usage, NOW)).toBe(['Weekly ending not-a-date: 100% used, 0% left', 'GrokBuild: 15%', 'Prepaid: unknown', 'Unified: no'].join('\n'));
});

test.for([
  { name: 'a null body', body: null },
  { name: 'a body without config', body: {} },
  { name: 'a missing creditUsagePercent', body: { config: {} } },
  { name: 'a non-numeric creditUsagePercent', body: { config: { creditUsagePercent: '17%' } } },
  { name: 'a blank creditUsagePercent', body: { config: { creditUsagePercent: ' ' } } },
  { name: 'a creditUsagePercent below 0', body: { config: { creditUsagePercent: -0.1 } } },
  { name: 'a creditUsagePercent above 100', body: { config: { creditUsagePercent: 100.1 } } },
  { name: 'a non-finite creditUsagePercent', body: { config: { creditUsagePercent: Number.NaN } } },
  { name: 'a productUsage that is not a list', body: { config: { creditUsagePercent: 1, productUsage: {} } } },
])('parseBillingCredits rejects $name', ({ body }) => {
  expect(parseBillingCredits(body)).toStrictEqual({ kind: 'unreadable' });
});

test('numeric strings for the pool, product split, and prepaid are percents and a balance', () => {
  const usage = parsedUsage({
    config: {
      creditUsagePercent: '17.5',
      currentPeriod: { type: 'USAGE_PERIOD_TYPE_WEEKLY' },
      productUsage: [
        { product: 'GrokBuild', usagePercent: '15' },
        { product: 'Cursor', usagePercent: '2' },
      ],
      prepaidBalance: { val: '0' },
      isUnifiedBillingUser: true,
    },
  });
  expect(usage.usedPercent).toBe(17.5);
  expect(usage.products).toStrictEqual([
    { product: 'GrokBuild', usagePercent: 15 },
    { product: 'Cursor', usagePercent: 2 },
  ]);
  expect(usage.prepaid).toBe(0);
  expect(formatPlanUsage(usage, NOW)).toBe(['Weekly: 17.5% used, 82.5% left', 'GrokBuild: 15%', 'Cursor: 2%', 'Prepaid: 0', 'Unified: yes'].join('\n'));
});

test('a non-numeric prepaid balance stays unknown', () => {
  const usage = parsedUsage({ config: { creditUsagePercent: 17, prepaidBalance: { val: 'none' } } });
  expect(usage.prepaid).toBeUndefined();
  expect(formatPlanUsage(usage, NOW)).toBe(['Plan: 17% used, 83% left', 'Products: none', 'Prepaid: unknown', 'Unified: unknown'].join('\n'));
});

test('fetchPlanUsage requests credits with the Grok Build headers', async () => {
  const timeout = vi.spyOn(AbortSignal, 'timeout');
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const usage = await fetchPlanUsage('token-1', {
    fetch: async (input, init) => {
      calls.push({ url: String(input), init });
      return new Response(JSON.stringify(billing), { status: 200 });
    },
  });
  expect(usage.usedPercent).toBe(17);
  expect(timeout).toHaveBeenCalledWith(30_000);
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({
    url: `${PROXY_BASE_URL}/billing?format=credits`,
    init: {
      redirect: 'error',
      headers: {
        Authorization: 'Bearer token-1',
        'X-XAI-Token-Auth': 'xai-grok-cli',
        Accept: 'application/json',
        'x-grok-client-version': GROK_CLIENT_VERSION,
      },
    },
  });
});

test.for([
  { status: 401, message: 'Grok Build rejected the session (HTTP 401). Run /login and choose Grok Build.' },
  { status: 403, message: 'Grok Build rejected the session (HTTP 403). Run /login and choose Grok Build.' },
  { status: 500, message: 'Grok Build usage failed (HTTP 500).' },
])('fetchPlanUsage reports HTTP $status', async ({ status, message }) => {
  const attempt = fetchPlanUsage('token-1', { fetch: async () => new Response('no', { status }) });
  await expect(attempt).rejects.toThrow(message);
});

test('fetchPlanUsage honors a caller timeout', async () => {
  const timeout = vi.spyOn(AbortSignal, 'timeout');
  await fetchPlanUsage('token-1', {
    timeoutMs: 5_000,
    fetch: async () => new Response(JSON.stringify(billing), { status: 200 }),
  });
  expect(timeout).toHaveBeenCalledWith(5_000);
});

test('fetchPlanUsage rejects a credits body that is not JSON', async () => {
  const attempt = fetchPlanUsage('token-1', { fetch: async () => new Response('not json', { status: 200 }) });
  await expect(attempt).rejects.toThrow('Grok Build returned usage Pi cannot read.');
});

test('fetchPlanUsage rejects a credits body it cannot read', async () => {
  const attempt = fetchPlanUsage('token-1', { fetch: async () => new Response('{"config":{}}', { status: 200 }) });
  await expect(attempt).rejects.toThrow('Grok Build returned usage Pi cannot read.');
});

function commandContext(apiKey: string | undefined, hasUI: boolean, authError?: unknown) {
  const notes: [string, string | undefined][] = [];
  const ctx = {
    hasUI,
    ui: { notify: (message: string, level?: string) => notes.push([message, level]) },
    modelRegistry: {
      getProviderAuth: async (provider: string) => {
        if (provider !== 'grok-build') return undefined;
        if (authError !== undefined) throw authError;
        return apiKey === undefined ? undefined : { auth: { apiKey } };
      },
    },
  } as unknown as ExtensionCommandContext;
  return { ctx, notes };
}

test('the usage command tells a logged-out user to log in', async () => {
  const { ctx, notes } = commandContext(undefined, true);
  await createUsageCommand().handler('', ctx);
  expect(notes).toEqual([['Grok Build is not logged in. Run /login and choose Grok Build.', 'error']]);
});

test.for([
  { name: 'an Error', authError: new Error('OAuth refresh failed for grok-build'), message: 'OAuth refresh failed for grok-build' },
  { name: 'a string', authError: 'OAuth refresh failed for grok-build', message: 'OAuth refresh failed for grok-build' },
])('the usage command reports $name from a failed credential refresh', async ({ authError, message }) => {
  const { ctx, notes } = commandContext(undefined, true, authError);
  await createUsageCommand().handler('', ctx);
  expect(notes).toEqual([[message, 'error']]);
});

test('the usage command prints the plan panel', async () => {
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify(billing), { status: 200 }));
  const { ctx, notes } = commandContext('token-1', true);
  await createUsageCommand().handler('', ctx);
  expect(notes[0]?.[1]).toBe('info');
  expect(notes[0]?.[0]).toContain('17% used, 83% left');
  expect(notes[0]?.[0]).toContain('GrokBuild: 15%');
  expect(notes[0]?.[0]).toContain('Cursor: 2%');
  expect(notes[0]?.[0]).toContain('resets in');
});

test('without a UI the usage command writes the panel to stderr', async () => {
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify(billing), { status: 200 }));
  const written: string[] = [];
  vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: string | Uint8Array) => {
    if (typeof chunk === 'string') written.push(chunk);
    return true;
  }) as typeof process.stderr.write);
  const { ctx, notes } = commandContext('token-1', false);
  await createUsageCommand().handler('', ctx);
  expect(notes).toEqual([]);
  expect(written.join('')).toContain('83% left');
});

test('the usage command reports a failed lookup', async () => {
  vi.stubGlobal('fetch', () => Promise.reject(new Error('network down')));
  const { ctx, notes } = commandContext('token-1', true);
  await createUsageCommand().handler('', ctx);
  expect(notes).toEqual([['network down', 'error']]);
});

test('the usage command stringifies a non-Error failure', async () => {
  vi.stubGlobal('fetch', () => Promise.reject('boom'));
  const { ctx, notes } = commandContext('token-1', true);
  await createUsageCommand().handler('', ctx);
  expect(notes).toEqual([['boom', 'error']]);
});
