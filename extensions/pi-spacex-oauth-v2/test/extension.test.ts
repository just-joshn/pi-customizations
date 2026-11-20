import type { OAuthLoginCallbacks, RefreshModelsContext } from '@earendil-works/pi-ai';
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import piSpacexOauth from '../src/index.ts';
import { fakeSdk, sdk } from './fake-sdk.ts';

vi.mock('@cursor/sdk', async (importOriginal) => ({ ...(await importOriginal<object>()), ...(await import('./fake-sdk.ts')).fakeSdk }));

// biome-ignore lint/suspicious/noExplicitAny: the registered provider and command configs are read by shape
type Loose = any;
type Handler = (event: never, ctx: ExtensionContext) => unknown;
const HTTP_OK = 200;
const HTTP_BAD_REQUEST = 400;
const HTTP_FORBIDDEN = 403;
const HTTP_SERVER_ERROR = 500;
const BILLING_PATH = '/billing';
const USAGE_COMMAND = '/spacex-usage';
const ACCOUNTS_DEVICE_URL = 'https://accounts.x.ai/device';
const CREDITS_USED = 42;
const CODE_LIFETIME_SECONDS = 600;
const SHORT_CODE_LIFETIME_SECONDS = 10;
const POLL_INTERVAL_SECONDS = 5;
const DEFAULT_TOKEN_TTL_SECONDS = 3600;
const MS_PER_SECOND = 1000;
const CANCEL_DELAY_MS = 10;
const deviceCodeBody = (expiresIn: number) => ({ device_code: 'd', user_code: 'U', verification_uri: 'v', expires_in: expiresIn, interval: POLL_INTERVAL_SECONDS });
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const rateHeaders = { 'x-ratelimit-limit-tokens': '53000000', 'x-ratelimit-remaining-tokens': '52000000', 'x-ratelimit-limit-requests': '8300', 'x-ratelimit-remaining-requests': '8299' };

function loadExtension() {
  let handlers: [string, Handler][] = [];
  let providers: [string, Loose][] = [];
  let commands: [string, Loose][] = [];
  const pi = {
    registerProvider: (id: string, config: unknown) => {
      providers = [...providers, [id, config]];
    },
    registerCommand: (name: string, def: unknown) => {
      commands = [...commands, [name, def]];
    },
    on: (event: string, handler: Handler) => {
      handlers = [...handlers, [event, handler]];
    },
  } as unknown as ExtensionAPI;
  piSpacexOauth(pi);
  return { providers: new Map(providers), commands: new Map(commands), handlers: new Map(handlers) };
}

function makeCtx(opts: { provider?: string; tokens?: Record<string, string>; hasUI?: boolean; authFailure?: string } = {}) {
  const setStatus = vi.fn();
  const notify = vi.fn();
  const ctx = {
    hasUI: opts.hasUI ?? true,
    model: opts.provider ? { provider: opts.provider } : undefined,
    modelRegistry: { getProviderAuth: async (p: string) => (opts.authFailure ? Promise.reject(opts.authFailure) : opts.tokens?.[p] ? { auth: { apiKey: opts.tokens[p] } } : undefined) },
    ui: { setStatus, notify, theme: { fg: (_c: string, t: string) => `<${t}>` } },
  } as unknown as ExtensionContext;
  return { ctx, setStatus, notify };
}

function stubNetwork(overrides: { grokStatus?: number; grokBody?: unknown } = {}) {
  const fetch = vi.fn(async (url: string) => {
    if (url.endsWith(BILLING_PATH)) {
      if (overrides.grokStatus) return new Response('', { status: overrides.grokStatus });
      return json(HTTP_OK, overrides.grokBody ?? { config: { used: { val: CREDITS_USED }, billingPeriodEnd: '2026-11-28T00:00:00Z' } });
    }
    throw new Error(`unexpected ${url}`);
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

beforeEach(() => {
  sdk.reset();
  fakeSdk.Cursor.me.mockResolvedValue({ apiKeyName: 'Pi', userEmail: 'me@example.com', createdAt: '2026-11-01' });
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-15T12:00:00Z'));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('registration', () => {
  test('registers the Grok Build and Cursor providers and the /spacex-usage command', () => {
    const { providers, commands } = loadExtension();
    expect([...providers.keys()].toSorted()).toStrictEqual(['spacex-cursor', 'spacex-grok']);
    expect(providers.get('spacex-grok').models.map((m: { id: string }) => m.id)).toContain('grok-4.7');
    expect(providers.get('spacex-cursor').models.map((m: { id: string }) => m.id)).toContain('composer-2.5');
    expect(commands.has('spacex-usage')).toBe(true);
  });
});

describe(USAGE_COMMAND, () => {
  const run = async (ctx: ExtensionContext, loaded = loadExtension()) => loaded.commands.get('spacex-usage').handler('', ctx);

  test('asks the user to sign in when no subscription is connected', async () => {
    const { ctx, notify } = makeCtx();
    await run(ctx);
    expect(notify).toHaveBeenCalledWith('Sign in with /login (Grok Build or Cursor) to see usage.', 'info');
  });

  test('shows the signed-in Cursor account and Grok billing when both are signed in', async () => {
    stubNetwork();
    const { ctx, notify } = makeCtx({ tokens: { 'spacex-cursor': 'c-tok', 'spacex-grok': 'g-tok' } });
    await run(ctx);
    const [text, level] = notify.mock.calls[0] as [string, string];
    expect(level).toBe('info');
    expect(text).toMatch(/^Cursor: signed in as me@example\.com\. See cursor\.com\/dashboard\/usage for plan usage\.\nGrok Build credits used: 42, period ends/);
    expect(fakeSdk.Cursor.me).toHaveBeenCalledWith({ apiKey: 'c-tok' });
  });

  test('names the Cursor key when the account has no email, and Grok falls back to defaults', async () => {
    stubNetwork({ grokBody: {} });
    fakeSdk.Cursor.me.mockResolvedValue({ apiKeyName: 'Pi key', createdAt: '2026-11-01' });
    const { ctx, notify } = makeCtx({ tokens: { 'spacex-cursor': 'c', 'spacex-grok': 'g' } });
    await run(ctx);
    expect(notify.mock.calls[0]?.[0]).toMatch(/^Cursor: signed in as Pi key\./);
    expect(notify.mock.calls[0]?.[0]).toContain('Grok Build credits used: 0');
  });

  test('reports a failed Cursor lookup instead of throwing', async () => {
    fakeSdk.Cursor.me.mockRejectedValue(new Error('Invalid User API Key'));
    const { ctx, notify } = makeCtx({ tokens: { 'spacex-cursor': 'bad' } });
    await run(ctx);
    expect(notify.mock.calls[0]?.[0]).toBe('Usage lookup failed: Invalid User API Key');
  });

  test('reports a failed Grok billing lookup', async () => {
    stubNetwork({ grokStatus: HTTP_SERVER_ERROR });
    const { ctx, notify } = makeCtx({ tokens: { 'spacex-grok': 'bad' } });
    await run(ctx);
    expect(notify.mock.calls[0]?.[0]).toBe('Usage lookup failed: Grok billing failed: HTTP 500');
  });

  test('stringifies non-Error failures', async () => {
    const { ctx, notify } = makeCtx({ authFailure: 'boom' });
    await run(ctx);
    expect(notify.mock.calls[0]?.[0]).toBe('Usage lookup failed: boom');
  });

  test('includes the last Grok rate limit seen on a provider response', async () => {
    const loaded = loadExtension();
    const { ctx, notify } = makeCtx({ provider: 'spacex-grok' });
    loaded.handlers.get('after_provider_response')?.({ headers: rateHeaders } as never, ctx);
    await run(ctx, loaded);
    expect(notify.mock.calls[0]?.[0]).toBe('Grok Build rate limit: 8299/8300 requests, 52.0M/53.0M tokens left');
  });
});

describe('footer status', () => {
  test('is cleared when the active model is not a SpaceX provider', async () => {
    const { handlers } = loadExtension();
    const { ctx, setStatus } = makeCtx({ provider: 'anthropic' });
    await handlers.get('session_start')?.({} as never, ctx);
    expect(setStatus).toHaveBeenCalledWith('spacex-usage', undefined);
  });

  test('does nothing without a UI, and clears the footer without a model', async () => {
    const { handlers } = loadExtension();
    const noUi = makeCtx({ hasUI: false, provider: 'spacex-cursor' });
    await handlers.get('session_start')?.({} as never, noUi.ctx);
    expect(noUi.setStatus).not.toHaveBeenCalled();
    const noModel = makeCtx();
    await handlers.get('model_select')?.({} as never, noModel.ctx);
    expect(noModel.setStatus).toHaveBeenCalledWith('spacex-usage', undefined);
  });

  test('shows remaining Grok requests when only Grok is signed in', async () => {
    const { handlers } = loadExtension();
    const { ctx, setStatus } = makeCtx({ provider: 'spacex-grok' });
    handlers.get('after_provider_response')?.({ headers: rateHeaders } as never, ctx);
    await handlers.get('session_start')?.({} as never, ctx);
    await vi.waitFor(() => expect(setStatus).toHaveBeenCalledWith('spacex-usage', '<8299 req left>'));
  });

  test('keeps the previous rate limit when a response has no rate-limit headers', async () => {
    const { handlers } = loadExtension();
    const { ctx, setStatus } = makeCtx({ provider: 'spacex-grok' });
    handlers.get('after_provider_response')?.({ headers: rateHeaders } as never, ctx);
    handlers.get('after_provider_response')?.({ headers: {} } as never, ctx);
    await handlers.get('model_select')?.({} as never, ctx);
    await vi.waitFor(() => expect(setStatus).toHaveBeenCalledWith('spacex-usage', '<8299 req left>'));
  });

  test('ignores rate limits from other providers', async () => {
    const { handlers } = loadExtension();
    const { ctx, setStatus } = makeCtx({ provider: 'spacex-cursor' });
    handlers.get('after_provider_response')?.({ headers: rateHeaders } as never, ctx);
    await handlers.get('session_start')?.({} as never, ctx);
    await vi.waitFor(() => expect(setStatus).toHaveBeenCalledWith('spacex-usage', undefined));
  });

  test('refreshes on every turn without a network call', async () => {
    const fetch = stubNetwork();
    const { handlers } = loadExtension();
    const { ctx, setStatus } = makeCtx({ provider: 'spacex-grok' });
    handlers.get('after_provider_response')?.({ headers: rateHeaders } as never, ctx);
    handlers.get('turn_end')?.({} as never, ctx);
    expect(setStatus).toHaveBeenCalledWith('spacex-usage', '<8299 req left>');
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('model catalog refresh', () => {
  const refreshCtx = (over: Partial<RefreshModelsContext>) => ({ allowNetwork: true, signal: new AbortController().signal, publish: vi.fn(async () => undefined), ...over }) as unknown as RefreshModelsContext;
  const oauthCredential = { type: 'oauth', access: 'tok', refresh: 'r', expires: 0 } as never;

  test('offline or signed-out starts reuse the stored catalog, else the built-in list', async () => {
    const { providers } = loadExtension();
    const grok = providers.get('spacex-grok');
    const stored = [{ id: 'stored-model' }];
    expect(await grok.refreshModels(refreshCtx({ allowNetwork: false, stored: { models: stored } as never }))).toBe(stored);
    expect(await grok.refreshModels(refreshCtx({ credential: { type: 'api_key' } as never }))).toStrictEqual(grok.models);
    expect((await providers.get('spacex-cursor').refreshModels(refreshCtx({ allowNetwork: false }))).map((m: { id: string }) => m.id)).toStrictEqual(['composer-2.5']);
  });

  test('a signed-in refresh fetches the live Grok list and persists it', async () => {
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) => json(HTTP_OK, { data: [{ id: 'grok-5', name: 'Grok 5', reasoning_efforts: [{ value: 'high' }] }, { id: 'grok-img', api_backend: 'images' }, { id: 'grok-plain' }] }));
    vi.stubGlobal('fetch', fetch);
    const ctx = refreshCtx({ credential: oauthCredential });
    const models = await loadExtension().providers.get('spacex-grok').refreshModels(ctx);
    expect(models.map((m: { id: string }) => m.id)).toStrictEqual(['grok-5', 'grok-plain']);
    expect(models[0].thinkingLevelMap.high).toBe('high');
    expect(models[1].reasoning).toBe(false);
    expect(models[1].name).toBe('grok-plain');
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({ headers: { Authorization: 'Bearer tok' } });
    expect(ctx.publish).toHaveBeenCalledWith({ persist: expect.objectContaining({ checkedAt: Date.now(), models: [expect.objectContaining({ provider: 'spacex-grok', id: 'grok-5' }), expect.anything()] }) });
  });

  test('a failed Grok model list surfaces the HTTP status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: HTTP_FORBIDDEN })),
    );
    await expect(
      loadExtension()
        .providers.get('spacex-grok')
        .refreshModels(refreshCtx({ credential: oauthCredential })),
    ).rejects.toThrow('HTTP 403');
  });

  test('a signed-in Cursor refresh lists the live catalog; failures surface', async () => {
    const cursor = loadExtension().providers.get('spacex-cursor');
    const ctx = refreshCtx({ credential: { type: 'oauth', access: 'cursor-refresh', refresh: '', expires: 0 } as never });
    expect((await cursor.refreshModels(ctx)).map((m: { id: string }) => m.id)).toContain('grok-4.7');
    fakeSdk.Cursor.models.list.mockRejectedValue(new Error('Invalid User API Key'));
    await expect(cursor.refreshModels(ctx)).rejects.toThrow('Invalid User API Key');
  });
});

describe('Grok sign-in edge cases: device flow', () => {
  const cb = () => ({ onAuth: vi.fn(), onDeviceCode: vi.fn(), onPrompt: vi.fn(), onSelect: vi.fn() }) as unknown as OAuthLoginCallbacks & { onDeviceCode: ReturnType<typeof vi.fn> };
  const oauth = () => loadExtension().providers.get('spacex-grok').oauth;

  test('reports a rejected device-code request', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: HTTP_SERVER_ERROR })),
    );
    await expect(oauth().login(cb())).rejects.toThrow('Grok device sign-in failed: HTTP 500');
  });

  test('uses the plain verification URL and default 5s polling when the server gives no extras', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(json(HTTP_OK, { device_code: 'd', user_code: 'U', verification_uri: ACCOUNTS_DEVICE_URL, expires_in: CODE_LIFETIME_SECONDS }))
      .mockResolvedValueOnce(json(HTTP_OK, { access_token: 'a', refresh_token: 'r' }));
    vi.stubGlobal('fetch', fetch);
    const callbacks = cb();
    const login = oauth().login(callbacks);
    await vi.runAllTimersAsync();
    const creds = await login;
    expect(callbacks.onDeviceCode).toHaveBeenCalledWith(expect.objectContaining({ verificationUri: ACCOUNTS_DEVICE_URL, intervalSeconds: POLL_INTERVAL_SECONDS }));
    expect(creds.expires).toBe(Date.now() + DEFAULT_TOKEN_TTL_SECONDS * MS_PER_SECOND);
  });

  test('fails when the code expires before approval', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => (url.includes('device/code') ? json(HTTP_OK, deviceCodeBody(SHORT_CODE_LIFETIME_SECONDS)) : json(HTTP_BAD_REQUEST, { error: 'authorization_pending' }))),
    );
    const assertion = expect(oauth().login(cb())).rejects.toThrow('expired before it was approved');
    await vi.runAllTimersAsync();
    await assertion;
  });
});

describe('Grok sign-in edge cases: cancel and tokens', () => {
  const cb = () => ({ onAuth: vi.fn(), onDeviceCode: vi.fn(), onPrompt: vi.fn(), onSelect: vi.fn() }) as unknown as OAuthLoginCallbacks & { onDeviceCode: ReturnType<typeof vi.fn> };
  const oauth = () => loadExtension().providers.get('spacex-grok').oauth;

  test('cancelling while waiting rejects with the abort reason', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json(HTTP_OK, deviceCodeBody(CODE_LIFETIME_SECONDS))),
    );
    const controller = new AbortController();
    const assertion = expect(oauth().login({ ...cb(), signal: controller.signal })).rejects.toThrow('cancelled');
    await vi.advanceTimersByTimeAsync(CANCEL_DELAY_MS);
    controller.abort(new Error('cancelled'));
    await assertion;
  });

  test('a token answer with neither tokens nor an error says no token was returned', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(HTTP_OK, {})));
    await expect(oauth().refreshToken({ access: 'a', refresh: 'r', expires: 0 }, new AbortController().signal)).rejects.toThrow('no token returned');
  });

  test('getApiKey hands pi the access token', () => {
    expect(oauth().getApiKey({ access: 'acc', refresh: 'r', expires: 0 })).toBe('acc');
  });
});
