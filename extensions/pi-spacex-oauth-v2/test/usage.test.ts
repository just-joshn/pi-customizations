import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { fakeSdk, sdk } from './fake-sdk.ts';
import { CURSOR_ID, GROK_ID, jsonResponse, loadExtension, makeContext } from './host.ts';

vi.mock('@cursor/sdk', async (importOriginal) => ({ ...(await importOriginal<object>()), ...(await import('./fake-sdk.ts')).fakeSdk }));

const HTTP_OK = 200;
const HTTP_SERVER_ERROR = 500;
const USAGE_COMMAND = 'spacex-usage';
const CREDITS_USED = 42;
const SIGN_IN_PROMPT = 'Sign in with /login (Grok Build or Cursor) to see usage.';
const rateHeaders = { 'x-ratelimit-limit-tokens': '53000000', 'x-ratelimit-remaining-tokens': '52000000', 'x-ratelimit-limit-requests': '8300', 'x-ratelimit-remaining-requests': '8299' };
const GROK_BILLING_URL = 'https://cli-chat-proxy.grok.com/v1/billing';
const CURSOR_ACCOUNT_LINE = /^Cursor: signed in as me@example\.com\. See cursor\.com\/dashboard\/usage for plan usage\.\nGrok Build credits used: 42, period ends Sat, Nov 28, 12:00\sAM/;
const ACCOUNT_BILLING_AND_RATE_LIMIT_LINES = 3;
const CURSOR_ACCOUNT_TEXT = 'Cursor: signed in as me@example.com. See cursor.com/dashboard/usage for plan usage.';
const RATE_LIMIT_LINE = 'Grok Build rate limit: 8299/8300 requests, 52.0M/53.0M tokens left';

interface BillingStub {
  status?: number;
  body?: unknown;
}

function stubGrokBilling({ status = HTTP_OK, body }: BillingStub = {}) {
  let requests: { url: string; headers: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      requests = [...requests, { url, headers: init?.headers }];
      if (status !== HTTP_OK) return new Response('', { status });
      return jsonResponse(status, body ?? { config: { used: { val: CREDITS_USED }, billingPeriodEnd: '2026-11-28T00:00:00Z' } });
    }),
  );
  return () => requests;
}

async function usage(options: Parameters<typeof makeContext>[0], loaded = loadExtension()) {
  const { ctx, notifications } = makeContext(options);
  await loaded.runCommand(USAGE_COMMAND, ctx);
  return notifications();
}

beforeEach(() => {
  vi.stubEnv('TZ', 'UTC');
  sdk.reset();
  fakeSdk.Cursor.me.mockResolvedValue({ apiKeyName: 'Pi', userEmail: 'me@example.com', createdAt: '2026-11-01' });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('the spacex-usage command', () => {
  test('asks the user to sign in when no subscription is connected', async () => {
    expect(await usage({})).toStrictEqual([{ message: SIGN_IN_PROMPT, level: 'info' }]);
  });

  test('shows the signed-in Cursor account and Grok Build credits when both are signed in', async () => {
    const requests = stubGrokBilling();
    const [note] = await usage({ tokens: { [CURSOR_ID]: 'c-tok', [GROK_ID]: 'g-tok' } });
    expect(note?.level).toBe('info');
    expect(note?.message).toMatch(CURSOR_ACCOUNT_LINE);
    expect(fakeSdk.Cursor.me).toHaveBeenCalledWith({ apiKey: 'c-tok' });
    expect(requests()[0]?.url).toBe(GROK_BILLING_URL);
    expect(requests()[0]?.headers).toMatchObject({ Authorization: 'Bearer g-tok', 'x-grok-client-version': '1.0.77' });
  });

  test('shows only Cursor when Grok Build is not signed in', async () => {
    const requests = stubGrokBilling();
    const [note] = await usage({ tokens: { [CURSOR_ID]: 'c-tok' } });
    expect(note?.message).toMatch(/^Cursor: signed in as me@example\.com\./);
    expect(note?.message).not.toContain('Grok');
    expect(requests()).toStrictEqual([]);
  });

  test('names the Cursor key when the account has no email, and Grok billing falls back to zero credits', async () => {
    stubGrokBilling({ body: {} });
    fakeSdk.Cursor.me.mockResolvedValue({ apiKeyName: 'Pi key', createdAt: '2026-11-01' });
    const [note] = await usage({ tokens: { [CURSOR_ID]: 'c', [GROK_ID]: 'g' } });
    expect(note?.message).toMatch(/^Cursor: signed in as Pi key\./);
    expect(note?.message).toContain('Grok Build credits used: 0');
  });
});

describe('the spacex-usage command when a lookup fails', () => {
  test('reports a failed Cursor lookup instead of throwing', async () => {
    fakeSdk.Cursor.me.mockRejectedValue(new Error('Invalid User API Key'));
    expect(await usage({ tokens: { [CURSOR_ID]: 'bad' } })).toStrictEqual([{ message: 'Usage lookup failed: Invalid User API Key', level: 'info' }]);
  });

  test('reports a failed Grok billing lookup with its HTTP status', async () => {
    stubGrokBilling({ status: HTTP_SERVER_ERROR });
    const [note] = await usage({ tokens: { [GROK_ID]: 'bad' } });
    expect(note?.message).toBe('Usage lookup failed: Grok billing failed: HTTP 500');
  });

  test('still shows the Cursor account when Grok billing fails', async () => {
    stubGrokBilling({ status: HTTP_SERVER_ERROR });
    const [note] = await usage({ tokens: { [CURSOR_ID]: 'c-tok', [GROK_ID]: 'g-tok' } });
    expect(note?.message).toBe(`${CURSOR_ACCOUNT_TEXT}\nUsage lookup failed: Grok billing failed: HTTP 500`);
  });

  test('still shows Grok Build credits when the Cursor lookup fails', async () => {
    stubGrokBilling();
    fakeSdk.Cursor.me.mockRejectedValue(new Error('Invalid User API Key'));
    const [note] = await usage({ tokens: { [CURSOR_ID]: 'bad', [GROK_ID]: 'g-tok' } });
    expect(note?.message).toMatch(/^Usage lookup failed: Invalid User API Key\nGrok Build credits used: 42,/);
  });

  test('reports a non-Error failure by its text', async () => {
    const [note] = await usage({ authFailure: 'boom' });
    expect(note?.message).toBe('Usage lookup failed: boom');
  });

  test('shows neither credential when both lookups fail', async () => {
    stubGrokBilling({ status: HTTP_SERVER_ERROR });
    fakeSdk.Cursor.me.mockRejectedValue(new Error('Invalid User API Key'));
    const [note] = await usage({ tokens: { [CURSOR_ID]: 'cursor-secret', [GROK_ID]: 'grok-secret' } });
    expect(note?.message).not.toContain('cursor-secret');
    expect(note?.message).not.toContain('grok-secret');
  });
});

describe('the spacex-usage command Grok Build rate limit', () => {
  test('adds the last Grok Build rate limit seen on a provider response', async () => {
    const loaded = loadExtension();
    const { ctx, notifications } = makeContext({ provider: GROK_ID });
    await loaded.fire('after_provider_response', { headers: rateHeaders }, ctx);
    await loaded.runCommand(USAGE_COMMAND, ctx);
    expect(notifications()).toStrictEqual([{ message: RATE_LIMIT_LINE, level: 'info' }]);
  });

  test('puts the rate limit after the account and billing lines', async () => {
    stubGrokBilling();
    const loaded = loadExtension();
    const { ctx, notifications } = makeContext({ provider: GROK_ID, tokens: { [CURSOR_ID]: 'c', [GROK_ID]: 'g' } });
    await loaded.fire('after_provider_response', { headers: rateHeaders }, ctx);
    await loaded.runCommand(USAGE_COMMAND, ctx);
    const lines = notifications()[0]?.message.split('\n') ?? [];
    expect(lines).toHaveLength(ACCOUNT_BILLING_AND_RATE_LIMIT_LINES);
    expect(lines.at(-1)).toBe(RATE_LIMIT_LINE);
  });

  test('ignores a response with partial rate-limit headers', async () => {
    const loaded = loadExtension();
    const { ctx, notifications } = makeContext({ provider: GROK_ID });
    await loaded.fire('after_provider_response', { headers: { 'x-ratelimit-limit-requests': '8300' } }, ctx);
    await loaded.runCommand(USAGE_COMMAND, ctx);
    expect(notifications()).toStrictEqual([{ message: SIGN_IN_PROMPT, level: 'info' }]);
  });
});
