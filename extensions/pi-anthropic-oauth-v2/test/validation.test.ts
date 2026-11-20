import { normalizeContext, type Tool } from '@earendil-works/pi-ai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TOKEN_URL } from './support/constants.ts';
import { collect, model, register } from './support/provider.ts';

const oauth = () => register().config.oauth;

const streamError = async (context: ReturnType<typeof normalizeContext>) => {
  const { config } = register();
  return collect(config.streamSimple(model(), context, { apiKey: 'sk-ant-api-x' }));
};

const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

beforeEach(() => consoleError.mockClear());
afterEach(() => vi.unstubAllGlobals());

describe('login input validation', () => {
  it('rejects a blank authorization code before calling Anthropic', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(oauth().login({ onAuth: () => undefined, onPrompt: async () => '   ' })).rejects.toThrow('Paste the authorization code shown after you sign in to Claude.');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalled();
  });

  it('trims the pasted code', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ access_token: 'a', refresh_token: 'r', expires_in: 1 }) }));
    vi.stubGlobal('fetch', fetchMock);
    await oauth().login({ onAuth: () => undefined, onPrompt: async () => ' code#state\n' });
    expect(fetchMock).toHaveBeenCalledWith(TOKEN_URL, expect.objectContaining({ body: expect.stringContaining('"code":"code","state":"state"') }));
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
