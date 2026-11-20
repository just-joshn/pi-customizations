import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { fakeSdk, sdk } from './fake-sdk.ts';
import { CURSOR_ID, GROK_ID, loadExtension, makeContext, STATUS_KEY } from './host.ts';

vi.mock('@cursor/sdk', async (importOriginal) => ({ ...(await importOriginal<object>()), ...(await import('./fake-sdk.ts')).fakeSdk }));

const rateHeaders = { 'x-ratelimit-limit-tokens': '53000000', 'x-ratelimit-remaining-tokens': '52000000', 'x-ratelimit-limit-requests': '8300', 'x-ratelimit-remaining-requests': '8299' };
const REQUESTS_LEFT_STATUS = '<8299 req left>';

beforeEach(() => sdk.reset());
afterEach(() => vi.unstubAllGlobals());

describe('what the extension registers with Pi', () => {
  test('offers the Grok Build and Cursor providers and the /spacex-usage command', () => {
    const loaded = loadExtension();
    expect(loaded.providerIds()).toStrictEqual([CURSOR_ID, GROK_ID]);
    expect(loaded.commandNames()).toStrictEqual(['spacex-usage']);
  });

  test('lists the built-in Grok Build models before any live refresh', () => {
    const ids = loadExtension()
      .provider(GROK_ID)
      .config.models?.map((m) => m.id);
    expect(ids).toStrictEqual(['grok-4.7', 'grok-4.7-build-fast', 'grok-4.6', 'grok-4.5']);
  });

  test('lists Composer as the built-in Cursor model before any live refresh', () => {
    const ids = loadExtension()
      .provider(CURSOR_ID)
      .config.models?.map((m) => m.id);
    expect(ids).toStrictEqual(['composer-2.5']);
  });

  test('reads the Cursor API key from CURSOR_API_KEY', () => {
    expect(loadExtension().provider(CURSOR_ID).config.apiKey).toBe('$CURSOR_API_KEY');
  });
});

describe('footer status visibility', () => {
  test('is cleared when the active model is not a SpaceX provider', async () => {
    const loaded = loadExtension();
    const { ctx, statuses } = makeContext({ provider: 'anthropic' });
    await loaded.fire('session_start', {}, ctx);
    expect(statuses()).toStrictEqual([[STATUS_KEY, undefined]]);
  });

  test('is left alone without a UI', async () => {
    const loaded = loadExtension();
    const { ctx, statuses } = makeContext({ hasUI: false, provider: CURSOR_ID });
    await loaded.fire('session_start', {}, ctx);
    expect(statuses()).toStrictEqual([]);
  });

  test('is cleared when no model is selected', async () => {
    const loaded = loadExtension();
    const { ctx, statuses } = makeContext();
    await loaded.fire('model_select', {}, ctx);
    expect(statuses()).toStrictEqual([[STATUS_KEY, undefined]]);
  });
});

describe('footer status for Grok Build', () => {
  test('shows the remaining Grok Build requests once a Grok response reported them', async () => {
    const loaded = loadExtension();
    const { ctx, statuses } = makeContext({ provider: GROK_ID });
    await loaded.fire('after_provider_response', { headers: rateHeaders }, ctx);
    await loaded.fire('session_start', {}, ctx);
    expect(statuses()).toStrictEqual([[STATUS_KEY, REQUESTS_LEFT_STATUS]]);
  });

  test('keeps the previous rate limit when a response has no rate-limit headers', async () => {
    const loaded = loadExtension();
    const { ctx, statuses } = makeContext({ provider: GROK_ID });
    await loaded.fire('after_provider_response', { headers: rateHeaders }, ctx);
    await loaded.fire('after_provider_response', { headers: { 'content-type': 'text/event-stream' } }, ctx);
    await loaded.fire('model_select', {}, ctx);
    expect(statuses()).toStrictEqual([[STATUS_KEY, REQUESTS_LEFT_STATUS]]);
  });

  test('shows nothing for Grok before any response reported a rate limit', async () => {
    const loaded = loadExtension();
    const { ctx, statuses } = makeContext({ provider: GROK_ID });
    await loaded.fire('session_start', {}, ctx);
    expect(statuses()).toStrictEqual([[STATUS_KEY, undefined]]);
  });

  test('ignores rate limits from other providers', async () => {
    const loaded = loadExtension();
    const { ctx, statuses } = makeContext({ provider: CURSOR_ID });
    await loaded.fire('after_provider_response', { headers: rateHeaders }, ctx);
    await loaded.fire('session_start', {}, ctx);
    expect(statuses()).toStrictEqual([[STATUS_KEY, undefined]]);
  });

  test('refreshes at the end of every turn without a network call', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const loaded = loadExtension();
    const { ctx, statuses } = makeContext({ provider: GROK_ID });
    await loaded.fire('after_provider_response', { headers: rateHeaders }, ctx);
    await loaded.fire('turn_end', {}, ctx);
    expect(statuses()).toStrictEqual([[STATUS_KEY, REQUESTS_LEFT_STATUS]]);
    expect(fetch).not.toHaveBeenCalled();
    expect(fakeSdk.Cursor.me).not.toHaveBeenCalled();
  });
});
