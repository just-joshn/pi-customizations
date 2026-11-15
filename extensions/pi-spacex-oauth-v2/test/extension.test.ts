import type { OAuthLoginCallbacks, RefreshModelsContext } from '@earendil-works/pi-ai';
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import piSpacexOauth from '../src/index.ts';

// biome-ignore lint/suspicious/noExplicitAny: the registered provider and command configs are read by shape
type Loose = any;
type Handler = (event: never, ctx: ExtensionContext) => unknown;
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const rateHeaders = { 'x-ratelimit-limit-tokens': '53000000', 'x-ratelimit-remaining-tokens': '52000000', 'x-ratelimit-limit-requests': '8300', 'x-ratelimit-remaining-requests': '8299' };

function loadExtension() {
  const handlers = new Map<string, Handler>();
  const providers = new Map<string, Loose>();
  const commands = new Map<string, Loose>();
  const pi = {
    registerProvider: (id: string, config: unknown) => providers.set(id, config),
    registerCommand: (name: string, def: unknown) => commands.set(name, def),
    on: (event: string, handler: Handler) => handlers.set(event, handler),
  } as unknown as ExtensionAPI;
  piSpacexOauth(pi);
  return { providers, commands, handlers };
}

function makeCtx(opts: { provider?: string; tokens?: Record<string, string>; hasUI?: boolean } = {}) {
  const setStatus = vi.fn();
  const notify = vi.fn();
  const ctx = {
    hasUI: opts.hasUI ?? true,
    model: opts.provider ? { provider: opts.provider } : undefined,
    modelRegistry: { getProviderAuth: async (p: string) => (opts.tokens?.[p] ? { auth: { apiKey: opts.tokens[p] } } : undefined) },
    ui: { setStatus, notify, theme: { fg: (_c: string, t: string) => `<${t}>` } },
  } as unknown as ExtensionContext;
  return { ctx, setStatus, notify };
}

const cursorBodies: Record<string, unknown> = {
  GetCurrentPeriodUsage: { billingCycleEnd: String(Date.UTC(2026, 10, 30)), planUsage: { totalPercentUsed: 12.34 } },
  GetPlanInfo: { planInfo: { planName: 'Super', includedUsageResetsAt: String(Date.UTC(2026, 10, 22, 10, 21)) } },
};

function stubNetwork(overrides: { cursorStatus?: number; grokStatus?: number; cursorBodies?: Record<string, unknown>; grokBody?: unknown } = {}) {
  const fetch = vi.fn(async (url: string) => {
    if (url.includes('DashboardService')) {
      if (overrides.cursorStatus) return new Response('', { status: overrides.cursorStatus });
      const method = url.split('/').pop() as string;
      return json(200, (overrides.cursorBodies ?? cursorBodies)[method]);
    }
    if (url.endsWith('/billing')) {
      if (overrides.grokStatus) return new Response('', { status: overrides.grokStatus });
      return json(200, overrides.grokBody ?? { config: { used: { val: 42 }, billingPeriodEnd: '2026-11-28T00:00:00Z' } });
    }
    throw new Error(`unexpected ${url}`);
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

beforeEach(() => {
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
    expect([...providers.keys()].sort()).toStrictEqual(['spacex-cursor', 'spacex-grok']);
    expect(providers.get('spacex-grok').models.map((m: { id: string }) => m.id)).toContain('grok-4.7');
    expect(providers.get('spacex-cursor').models.map((m: { id: string }) => m.id)).toContain('auto');
    expect(commands.has('spacex-usage')).toBe(true);
  });
});

describe('/spacex-usage', () => {
  const run = async (ctx: ExtensionContext, loaded = loadExtension()) => loaded.commands.get('spacex-usage').handler('', ctx);

  test('asks the user to sign in when no subscription is connected', async () => {
    const { ctx, notify } = makeCtx();
    await run(ctx);
    expect(notify).toHaveBeenCalledWith('Sign in with /login (Grok Build or Cursor) to see usage.', 'info');
  });

  test('shows Cursor plan usage and Grok billing when both are signed in', async () => {
    stubNetwork();
    const { ctx, notify } = makeCtx({ tokens: { 'spacex-cursor': 'c-tok', 'spacex-grok': 'g-tok' } });
    await run(ctx);
    const [text, level] = notify.mock.calls[0] as [string, string];
    expect(level).toBe('info');
    expect(text).toMatch(/^Super: 12\.3% of included usage, resets .*Nov/);
    expect(text).toContain('Grok Build credits used: 42, period ends');
  });

  test('falls back to defaults when the servers omit fields', async () => {
    stubNetwork({ cursorBodies: { GetCurrentPeriodUsage: {}, GetPlanInfo: {} }, grokBody: {} });
    const { ctx, notify } = makeCtx({ tokens: { 'spacex-cursor': 'c', 'spacex-grok': 'g' } });
    await run(ctx);
    expect(notify.mock.calls[0]?.[0]).toMatch(/^Cursor: 0\.0% of included usage/);
    expect(notify.mock.calls[0]?.[0]).toContain('Grok Build credits used: 0');
  });

  test('uses the billing-cycle end when the plan has no reset time', async () => {
    stubNetwork({ cursorBodies: { GetCurrentPeriodUsage: { billingCycleEnd: String(Date.UTC(2026, 11, 3)) }, GetPlanInfo: { planInfo: { planName: 'Pro' } } } });
    const { ctx, notify } = makeCtx({ tokens: { 'spacex-cursor': 'c' } });
    await run(ctx);
    expect(notify.mock.calls[0]?.[0]).toMatch(/^Pro: 0\.0%.*Dec/);
  });

  test('reports a failed Cursor lookup instead of throwing', async () => {
    stubNetwork({ cursorStatus: 401 });
    const { ctx, notify } = makeCtx({ tokens: { 'spacex-cursor': 'bad' } });
    await run(ctx);
    expect(notify.mock.calls[0]?.[0]).toMatch(/^Usage lookup failed: Cursor (GetCurrentPeriodUsage|GetPlanInfo) failed: HTTP 401$/);
  });

  test('reports a failed Grok billing lookup', async () => {
    stubNetwork({ grokStatus: 500 });
    const { ctx, notify } = makeCtx({ tokens: { 'spacex-grok': 'bad' } });
    await run(ctx);
    expect(notify.mock.calls[0]?.[0]).toBe('Usage lookup failed: Grok billing failed: HTTP 500');
  });

  test('stringifies non-Error failures', async () => {
    const { ctx, notify } = makeCtx();
    (ctx.modelRegistry as unknown as { getProviderAuth: () => Promise<never> }).getProviderAuth = async () => Promise.reject('boom');
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

  test('shows Cursor plan usage and throttles turn_end refreshes to one a minute', async () => {
    const fetch = stubNetwork();
    const { handlers } = loadExtension();
    const { ctx, setStatus } = makeCtx({ provider: 'spacex-cursor', tokens: { 'spacex-cursor': 'c' } });
    await handlers.get('session_start')?.({} as never, ctx);
    await vi.waitFor(() => expect(setStatus).toHaveBeenCalledTimes(1));
    expect(setStatus.mock.calls[0]?.[1]).toMatch(/^<Super: 12\.3%/);
    const calls = fetch.mock.calls.length;
    handlers.get('turn_end')?.({} as never, ctx);
    await vi.advanceTimersByTimeAsync(10);
    expect(fetch.mock.calls.length).toBe(calls);
    vi.setSystemTime(Date.now() + 61_000);
    handlers.get('turn_end')?.({} as never, ctx);
    await vi.waitFor(() => expect(setStatus).toHaveBeenCalledTimes(2));
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

  test('clears the status when the usage lookup fails', async () => {
    stubNetwork({ cursorStatus: 500 });
    const { handlers } = loadExtension();
    const { ctx, setStatus } = makeCtx({ provider: 'spacex-cursor', tokens: { 'spacex-cursor': 'c' } });
    await handlers.get('session_start')?.({} as never, ctx);
    await vi.waitFor(() => expect(setStatus).toHaveBeenCalledWith('spacex-usage', undefined));
  });
});

describe('model catalog refresh', () => {
  const refreshCtx = (over: Partial<RefreshModelsContext>) => ({ allowNetwork: true, signal: new AbortController().signal, publish: vi.fn(async () => {}), ...over }) as unknown as RefreshModelsContext;
  const oauthCredential = { type: 'oauth', access: 'tok', refresh: 'r', expires: 0 } as never;

  test('offline or signed-out starts reuse the stored catalog, else the built-in list', async () => {
    const { providers } = loadExtension();
    const grok = providers.get('spacex-grok');
    const stored = [{ id: 'stored-model' }];
    expect(await grok.refreshModels(refreshCtx({ allowNetwork: false, stored: { models: stored } as never }))).toBe(stored);
    expect(await grok.refreshModels(refreshCtx({ credential: { type: 'api_key' } as never }))).toStrictEqual(grok.models);
    expect((await providers.get('spacex-cursor').refreshModels(refreshCtx({ allowNetwork: false }))).map((m: { id: string }) => m.id)).toContain('auto');
  });

  test('a signed-in refresh fetches the live Grok list and persists it', async () => {
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) => json(200, { data: [{ id: 'grok-5', name: 'Grok 5', reasoning_efforts: [{ value: 'high' }] }, { id: 'grok-img', api_backend: 'images' }, { id: 'grok-plain' }] }));
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
      vi.fn(async () => new Response('', { status: 403 })),
    );
    await expect(
      loadExtension()
        .providers.get('spacex-grok')
        .refreshModels(refreshCtx({ credential: oauthCredential })),
    ).rejects.toThrow('HTTP 403');
  });

  test('a signed-in Cursor refresh collapses the live list; failures surface the status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json(200, { models: [{ modelId: 'composer-3', displayName: 'Composer 3' }] })),
    );
    const ctx = refreshCtx({ credential: oauthCredential });
    const cursor = loadExtension().providers.get('spacex-cursor');
    expect((await cursor.refreshModels(ctx)).map((m: { id: string }) => m.id)).toStrictEqual(['auto', 'composer-3']);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json(200, {})),
    );
    expect((await cursor.refreshModels(ctx)).map((m: { id: string }) => m.id)).toStrictEqual(['auto']);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 502 })),
    );
    await expect(cursor.refreshModels(ctx)).rejects.toThrow('HTTP 502');
  });
});

describe('Grok sign-in edge cases', () => {
  const cb = () => ({ onAuth: vi.fn(), onDeviceCode: vi.fn(), onPrompt: vi.fn(), onSelect: vi.fn() }) as unknown as OAuthLoginCallbacks & { onDeviceCode: ReturnType<typeof vi.fn> };
  const oauth = () => loadExtension().providers.get('spacex-grok').oauth;

  test('reports a rejected device-code request', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 500 })),
    );
    await expect(oauth().login(cb())).rejects.toThrow('Grok device sign-in failed: HTTP 500');
  });

  test('uses the plain verification URL and default 5s polling when the server gives no extras', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(json(200, { device_code: 'd', user_code: 'U', verification_uri: 'https://accounts.x.ai/device', expires_in: 600 }))
      .mockResolvedValueOnce(json(200, { access_token: 'a', refresh_token: 'r' }));
    vi.stubGlobal('fetch', fetch);
    const callbacks = cb();
    const login = oauth().login(callbacks);
    await vi.runAllTimersAsync();
    const creds = await login;
    expect(callbacks.onDeviceCode).toHaveBeenCalledWith(expect.objectContaining({ verificationUri: 'https://accounts.x.ai/device', intervalSeconds: 5 }));
    expect(creds.expires).toBe(Date.now() + 3600 * 1000);
  });

  test('fails when the code expires before approval', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => (url.includes('device/code') ? json(200, { device_code: 'd', user_code: 'U', verification_uri: 'v', expires_in: 10, interval: 5 }) : json(400, { error: 'authorization_pending' }))),
    );
    const assertion = expect(oauth().login(cb())).rejects.toThrow('expired before it was approved');
    await vi.runAllTimersAsync();
    await assertion;
  });

  test('cancelling while waiting rejects with the abort reason', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json(200, { device_code: 'd', user_code: 'U', verification_uri: 'v', expires_in: 600, interval: 5 })),
    );
    const controller = new AbortController();
    const assertion = expect(oauth().login({ ...cb(), signal: controller.signal })).rejects.toThrow('cancelled');
    await vi.advanceTimersByTimeAsync(10);
    controller.abort(new Error('cancelled'));
    await assertion;
  });

  test('a token answer with neither tokens nor an error says no token was returned', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(200, {})));
    await expect(oauth().refreshToken({ access: 'a', refresh: 'r', expires: 0 }, new AbortController().signal)).rejects.toThrow('no token returned');
  });

  test('getApiKey hands pi the access token', () => {
    expect(oauth().getApiKey({ access: 'acc', refresh: 'r', expires: 0 })).toBe('acc');
  });
});
