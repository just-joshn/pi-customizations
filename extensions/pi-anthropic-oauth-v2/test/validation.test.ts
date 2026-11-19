import { type AssistantMessageEvent, normalizeContext, type Tool } from '@earendil-works/pi-ai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import extension from '../src/index.ts';

type ProviderConfig = Parameters<Parameters<typeof extension>[0]['registerProvider']>[1];

const register = (): ProviderConfig => {
  const configs: ProviderConfig[] = [];
  extension({ registerProvider: (_name: string, config: ProviderConfig) => configs.push(config) } as never);
  const [config] = configs;
  if (!config?.oauth || !config.streamSimple) throw new Error('provider not registered');
  return config;
};

const oauth = () => {
  const { oauth: handlers } = register();
  if (!handlers) throw new Error('no oauth');
  return handlers;
};

const streamError = async (context: ReturnType<typeof normalizeContext>) => {
  const { streamSimple, models, baseUrl, api } = register();
  if (!streamSimple || !models?.[0]) throw new Error('no stream');
  const model = { ...models[0], api, provider: 'custom-anthropic', baseUrl } as never;
  const events: AssistantMessageEvent[] = [];
  for await (const event of streamSimple(model, context, { apiKey: 'sk-ant-api-x' })) events.push(event);
  return events;
};

const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

beforeEach(() => consoleError.mockClear());
afterEach(() => vi.unstubAllGlobals());

describe('login input validation', () => {
  it('rejects a blank authorization code before calling Anthropic', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(oauth().login({ onAuth: () => undefined, onPrompt: async () => '   ' } as never)).rejects.toThrow('Paste the authorization code shown after you sign in to Claude.');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalled();
  });

  it('trims the pasted code', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ access_token: 'a', refresh_token: 'r', expires_in: 1 }) }));
    vi.stubGlobal('fetch', fetchMock);
    await oauth().login({ onAuth: () => undefined, onPrompt: async () => ' code#state\n' } as never);
    expect(JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body))).toMatchObject({ code: 'code', state: 'state' });
  });
});

describe('token request errors', () => {
  it('turns a network failure into a readable error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed');
      }),
    );
    const error = await oauth()
      .refreshToken({ refresh: 'r', access: 'a', expires: 0 }, new AbortController().signal)
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('Token refresh failed: could not reach Anthropic. Check your connection and try again.');
    expect((error as Error).cause).toBeInstanceOf(TypeError);
  });

  it('rejects a token response without the expected fields', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => ({ access_token: 'a' }) })),
    );
    await expect(oauth().refreshToken({ refresh: 'r', access: 'a', expires: 0 }, new AbortController().signal)).rejects.toThrow('Token refresh failed: Anthropic returned an unexpected token response.');
  });
});

describe('request input validation', () => {
  it('reports an image type Anthropic does not accept', async () => {
    const context = normalizeContext({ messages: [{ role: 'user', content: [{ type: 'image', data: 'x', mimeType: 'image/bmp' }], timestamp: 1 }] });
    const events = await streamError(context);
    expect(events.map((event) => event.type)).toEqual(['error']);
    expect(events[0]).toMatchObject({ error: { stopReason: 'error', errorMessage: 'Anthropic does not accept image/bmp images. Use JPEG, PNG, GIF, or WebP.' } });
  });

  it('reports a tool with an invalid parameter schema', async () => {
    const tool: Tool = { name: 'broken', description: 'Broken', parameters: { type: 'object', properties: 'nope' } as never };
    const events = await streamError(normalizeContext({ messages: [{ role: 'user', content: 'hi', timestamp: 1 }], tools: [tool] }));
    expect(events[0]).toMatchObject({ error: { errorMessage: 'Tool "broken" has an invalid parameter schema.' } });
    expect(consoleError).toHaveBeenCalled();
  });
});

describe('registration errors', () => {
  it('wraps a registration failure', () => {
    const pi = {
      registerProvider: () => {
        throw new Error('duplicate');
      },
    };
    expect(() => extension(pi as never)).toThrow('Could not register the custom-anthropic provider.');
  });
});
