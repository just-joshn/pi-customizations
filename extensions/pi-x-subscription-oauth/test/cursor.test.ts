import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { createModels, InMemoryCredentialStore, type OAuthCredential } from '@earendil-works/pi-ai';
import { expect, vi } from 'vitest';
import { exchangeCursorApiKey, expiresAt, loginCursor, readKeychainCredential, refreshCursor, runCursorAgentLogin, scrubText } from '../src/cursor/auth.ts';
import { CURSOR_LOGIN_HINT, parseUsableModels, usableModelsUrl } from '../src/cursor/catalog.ts';
import { createCursorProvider } from '../src/cursor/provider.ts';
import { cursorAgentArgs, promptFrom, readAgentResult, runCursorAgent } from '../src/cursor/stream.ts';
import extension from '../src/index.ts';
import { test } from './network-guard.ts';
import { oauthCredential } from './support/credentials.ts';
import { providerNamed, register } from './support/fake-pi.ts';

const fixtureUrl = new URL('./fixtures/cursor/usable-models.json', import.meta.url);
const SUCCESS = `${JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'pong', usage: { input_tokens: 3, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } })}\n`;

function cursorCredential(access = 'cursor-access'): OAuthCredential {
  return { ...oauthCredential(), access, refresh: 'cursor-refresh' };
}

async function storeCursor(credential: OAuthCredential): Promise<InMemoryCredentialStore> {
  const store = new InMemoryCredentialStore();
  await store.modify('cursor', async () => credential);
  return store;
}

test('the extension registers grok-build and cursor', () => {
  const registrations = register(extension);
  expect(registrations.providers.map((provider) => provider.id).sort()).toStrictEqual(['cursor', 'grok-build']);
  const cursor = providerNamed(registrations, 'cursor');
  expect(cursor.name).toBe('Cursor (The X Subscription)');
  expect(cursor.auth.oauth?.loginLabel).toBe('Sign in with Cursor');
  expect(cursor.getModels().map((model) => model.id)).toContain('composer-2.5');
});

test('GetUsableModels keeps valid ids and drops the rest', async () => {
  const parsed = parseUsableModels(JSON.parse(await readFile(fileURLToPath(fixtureUrl), 'utf8')));
  expect(parsed).toEqual({
    kind: 'ok',
    models: [
      { id: 'composer-2.5', name: 'Composer 2.5' },
      { id: 'default', name: 'Auto' },
      { id: 'claude-sonnet-5', name: 'Sonnet' },
    ],
  });
});

test('a catalog body without models is unreadable', () => {
  expect(parseUsableModels({ models: 'nope' })).toEqual({ kind: 'unreadable' });
});

test('the agent argv is ask mode for the requested model', () => {
  expect(cursorAgentArgs('composer-2.5', 'ping')).toStrictEqual(['--trust', '--print', '--output-format', 'json', '--mode', 'ask', '--model', 'composer-2.5', '--', 'ping']);
});

test('a prompt that starts with a dash stays a prompt', () => {
  expect(cursorAgentArgs('composer-2.5', '- old line\n+ new line')).toStrictEqual(['--trust', '--print', '--output-format', 'json', '--mode', 'ask', '--model', 'composer-2.5', '--', '- old line\n+ new line']);
});

test('a JSON result line is the reply text', () => {
  const reply = readAgentResult(`noise\n${SUCCESS}`);
  expect(reply).toMatchObject({ kind: 'text', text: 'pong', usage: { input: 3, output: 1, totalTokens: 4 } });
});

test('camelCase usage from cursor-agent is the reply usage', () => {
  const reply = readAgentResult(`${JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'pong', usage: { inputTokens: 11088, outputTokens: 24, cacheReadTokens: 9, cacheWriteTokens: 2 } })}\n`);
  expect(reply).toMatchObject({ kind: 'text', text: 'pong', usage: { input: 11088, output: 24, cacheRead: 9, cacheWrite: 2, totalTokens: 11123 } });
});

test('an agent error line is not reply text', () => {
  const reply = readAgentResult(`${JSON.stringify({ type: 'result', subtype: 'success', is_error: true, result: 'weekly usage' })}\n`);
  expect(reply).toEqual({ kind: 'error', message: 'weekly usage' });
});

test('login uses an existing Cursor session and does not spawn cursor-agent', async () => {
  const session = cursorCredential();
  const runLogin = vi.fn(async () => undefined);
  const credential = await loginCursor(new AbortController().signal, async () => session, runLogin);
  expect(credential.access).toBe(session.access);
  expect(runLogin).not.toHaveBeenCalled();
});

test('login runs cursor-agent when the keychain has no session', async () => {
  const session = cursorCredential();
  let reads = 0;
  const runLogin = vi.fn(async () => undefined);
  const credential = await loginCursor(
    new AbortController().signal,
    async () => {
      reads += 1;
      return reads === 1 ? undefined : session;
    },
    runLogin,
  );
  expect(runLogin).toHaveBeenCalledOnce();
  expect(credential).toBe(session);
});

test('a thrown login error does not keep a session token', async () => {
  const token = `eyJhbGciOiJub25lIn0.${Buffer.from('{"sub":"user"}').toString('base64url')}.signature1`;
  await expect(
    loginCursor(
      new AbortController().signal,
      async () => undefined,
      async () => Promise.reject(new Error(`failed ${token}`)),
    ),
  ).rejects.toThrow('failed [redacted]');
});

test('login without a session after cursor-agent names Cursor login', async () => {
  await expect(
    loginCursor(
      new AbortController().signal,
      async () => undefined,
      async () => undefined,
    ),
  ).rejects.toThrow(CURSOR_LOGIN_HINT);
});

test('a JWT exp claim becomes the credential expiry', () => {
  const payload = Buffer.from(JSON.stringify({ exp: 1_800_000_000 })).toString('base64url');
  expect(expiresAt(`eyJhbGciOiJub25lIn0.${payload}.sig`)).toBe(1_800_000_000_000);
});

test('scrubbed errors do not keep a session token', () => {
  const token = `eyJhbGciOiJub25lIn0.${Buffer.from('{"sub":"user"}').toString('base64url')}.signature1`;
  expect(scrubText(`failed ${token} and cursor-access`, ['cursor-access'])).toBe('failed [redacted] and [redacted]');
});

test('a fake cursor-agent ask returns the result text', async () => {
  const seen: string[][] = [];
  const provider = createCursorProvider({
    runAgent: async (args) => {
      seen.push([...args]);
      return { code: 0, stdout: SUCCESS, stderr: '' };
    },
  });
  const models = createModels({ credentials: await storeCursor(cursorCredential()) });
  models.setProvider(provider);
  const model = models.getModel('cursor', 'composer-2.5');
  if (!model) throw new Error('cursor/composer-2.5 is not listed');
  const message = await models.streamSimple(model, { messages: [{ role: 'user', content: 'ping', timestamp: 1 }] }).result();
  expect(message.stopReason).toBe('stop');
  expect(message.content).toEqual([{ type: 'text', text: 'pong' }]);
  expect(seen[0]).toEqual(cursorAgentArgs('composer-2.5', 'User:\nping'));
  expect(JSON.stringify(seen)).not.toContain('cursor-access');
});

test('a quiet non-zero exit reports the process failure', async () => {
  const provider = createCursorProvider({
    runAgent: async () => ({ code: 1, stdout: '', stderr: '' }),
  });
  const models = createModels({ credentials: await storeCursor(cursorCredential()) });
  models.setProvider(provider);
  const model = models.getModel('cursor', 'composer-2.5');
  if (!model) throw new Error('cursor/composer-2.5 is not listed');
  const message = await models.streamSimple(model, { messages: [{ role: 'user', content: 'ping', timestamp: 1 }] }).result();
  expect(message.stopReason).toBe('error');
  expect(message.errorMessage).toBe('cursor-agent exited 1.');
});

test('a failed ask shows the agent error and hides the session token', async () => {
  const provider = createCursorProvider({
    runAgent: async () => ({ code: 1, stdout: '', stderr: 'Cannot use this model cursor-secret' }),
  });
  const models = createModels({ credentials: await storeCursor(cursorCredential('cursor-secret')) });
  models.setProvider(provider);
  const model = models.getModel('cursor', 'composer-2.5');
  if (!model) throw new Error('cursor/composer-2.5 is not listed');
  const message = await models.streamSimple(model, { messages: [{ role: 'user', content: 'ping', timestamp: 1 }] }).result();
  expect(message.stopReason).toBe('error');
  expect(message.errorMessage).toContain('Cannot use this model');
  expect(message.errorMessage).not.toContain('cursor-secret');
});

test('a missing cursor-agent names the binary', async () => {
  const provider = createCursorProvider({
    runAgent: async () => {
      throw new Error('cursor-agent is not installed. Install the Cursor CLI, then run cursor-agent login.');
    },
  });
  const models = createModels({ credentials: await storeCursor(cursorCredential()) });
  models.setProvider(provider);
  const model = models.getModel('cursor', 'composer-2.5');
  if (!model) throw new Error('cursor/composer-2.5 is not listed');
  const message = await models.streamSimple(model, { messages: [{ role: 'user', content: 'ping', timestamp: 1 }] }).result();
  expect(message.stopReason).toBe('error');
  expect(message.errorMessage).toContain('cursor-agent');
});

test('a logged-out catalog refresh names Cursor login', async () => {
  const provider = createCursorProvider();
  await expect(provider.refreshModels?.({ allowNetwork: true, signal: new AbortController().signal, publish: async () => true })).rejects.toThrow(CURSOR_LOGIN_HINT);
});

test('catalog refresh posts GetUsableModels with the Cursor bearer and blocks other hosts', async () => {
  const credential = cursorCredential('cursor-secret');
  const url = usableModelsUrl('https://api2.cursor.sh');
  const requests: { url: string; authorization: string | null; method: string | undefined }[] = [];
  const delegate = globalThis.fetch;
  vi.stubGlobal('fetch', async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const href = input instanceof Request ? input.url : String(input);
    if (href !== url) return delegate(input, init);
    requests.push({ url: href, authorization: new Headers(init?.headers).get('authorization'), method: init?.method });
    return Response.json({
      models: [
        { modelId: 'composer-2.5', displayName: 'Composer 2.5' },
        { modelId: 'gpt-5.4', displayName: 'GPT' },
      ],
    });
  });
  const models = createModels({ credentials: await storeCursor(credential) });
  models.setProvider(createCursorProvider());
  const result = await models.refresh({ allowNetwork: true, providers: ['cursor'] });
  expect(result.errors.get('cursor')).toBeUndefined();
  expect(requests).toEqual([{ url, authorization: 'Bearer cursor-secret', method: 'POST' }]);
  expect(models.getModel('cursor', 'gpt-5.4')?.id).toBe('gpt-5.4');
  await expect(fetch('https://example.invalid/blocked')).rejects.toThrow('Blocked external network request');
  expect(result.errors.get('cursor')?.message ?? '').not.toContain('cursor-secret');
});

test('a keychain reader with no access item stays logged out', async () => {
  await expect(readKeychainCredential(async () => undefined)).resolves.toBeUndefined();
});

test('a keychain access item becomes the Pi credential', async () => {
  const credential = await readKeychainCredential(async (service) => (service === 'cursor-access-token' ? 'access-item' : undefined));
  expect(credential).toMatchObject({ type: 'oauth', access: 'access-item', refresh: 'cursor-keychain' });
});

test('refresh exchanges the API key and does not store that key', async () => {
  const payload = Buffer.from(JSON.stringify({ exp: 1_800_000_000 })).toString('base64url');
  const access = `eyJhbGciOiJub25lIn0.${payload}.sig`;
  const seen: string[] = [];
  const credential = await refreshCursor(
    new AbortController().signal,
    async () => {
      seen.push('read');
      return 'cursor-api-key';
    },
    async (apiKey) => {
      seen.push(apiKey);
      return { access, refresh: access };
    },
  );
  expect(seen).toEqual(['read', 'cursor-api-key']);
  expect(credential.access).toBe(access);
  expect(credential.refresh).toBe(access);
  expect(credential.expires).toBe(1_800_000_000_000);
  expect(JSON.stringify(credential)).not.toContain('cursor-api-key');
});

test('refresh without an API key tells the user to log in', async () => {
  const exchange = vi.fn(async () => ({ access: 'minted' }));
  await expect(refreshCursor(new AbortController().signal, async () => undefined, exchange)).rejects.toThrow(CURSOR_LOGIN_HINT);
  expect(exchange).not.toHaveBeenCalled();
});

test('a rejected API key exchange tells the user to log in', async () => {
  await expect(
    refreshCursor(
      new AbortController().signal,
      async () => 'cursor-api-key',
      async () => Promise.reject(new Error('HTTP 401')),
    ),
  ).rejects.toThrow(CURSOR_LOGIN_HINT);
});

test('exchange posts the API key and reads the minted access token', async () => {
  const payload = Buffer.from(JSON.stringify({ exp: 1_800_000_000 })).toString('base64url');
  const access = `eyJhbGciOiJub25lIn0.${payload}.sig`;
  const requests: { url: string; authorization: string | null; body: string | undefined }[] = [];
  const minted = await exchangeCursorApiKey('cursor-api-key', new AbortController().signal, async (input, init) => {
    requests.push({ url: String(input), authorization: new Headers(init?.headers).get('authorization'), body: typeof init?.body === 'string' ? init.body : undefined });
    return Response.json({ accessToken: access, refreshToken: access });
  });
  expect(requests).toEqual([{ url: 'https://api2.cursor.sh/auth/exchange_user_api_key', authorization: 'Bearer cursor-api-key', body: '{}' }]);
  expect(minted).toEqual({ access, refresh: access });
});

test('an exchange that returns no access token tells the user to log in', async () => {
  await expect(exchangeCursorApiKey('cursor-api-key', new AbortController().signal, async () => Response.json({}))).rejects.toThrow(CURSOR_LOGIN_HINT);
  await expect(exchangeCursorApiKey('cursor-api-key', new AbortController().signal, async () => new Response('no', { status: 401 }))).rejects.toThrow(CURSOR_LOGIN_HINT);
});

test('login mints a session when the stored access token is near expiry', async () => {
  const fresh = cursorCredential('fresh-access');
  const runLogin = vi.fn(async () => undefined);
  const mint = vi.fn(async () => fresh);
  const credential = await loginCursor(new AbortController().signal, async () => ({ ...cursorCredential(), expires: Date.now() + 30_000 }), runLogin, mint);
  expect(credential).toBe(fresh);
  expect(runLogin).not.toHaveBeenCalled();
});

test('login runs cursor-agent when the API key exchange cannot mint', async () => {
  const session = cursorCredential();
  let reads = 0;
  const runLogin = vi.fn(async () => undefined);
  const credential = await loginCursor(
    new AbortController().signal,
    async () => {
      reads += 1;
      return reads === 1 ? { ...cursorCredential(), expires: Date.now() - 1000 } : session;
    },
    runLogin,
    async () => Promise.reject(new Error(CURSOR_LOGIN_HINT)),
  );
  expect(runLogin).toHaveBeenCalledOnce();
  expect(credential).toBe(session);
});

test('a missing cursor-agent binary is named by the runner and by login', async () => {
  const previous = process.env['PATH'];
  process.env['PATH'] = '/nonexistent';
  try {
    await expect(runCursorAgent(['--version'], undefined)).rejects.toThrow('cursor-agent');
    await expect(runCursorAgentLogin(new AbortController().signal)).rejects.toThrow('cursor-agent');
  } finally {
    if (previous === undefined) delete process.env['PATH'];
    else process.env['PATH'] = previous;
  }
});

test('HTTP 401 on the catalog names Cursor login and hides the token', async () => {
  const credential = cursorCredential('cursor-secret');
  const url = usableModelsUrl('https://api2.cursor.sh');
  const delegate = globalThis.fetch;
  vi.stubGlobal('fetch', async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const href = input instanceof Request ? input.url : String(input);
    if (href !== url) return delegate(input, init);
    return new Response('cursor-secret', { status: 401 });
  });
  const models = createModels({ credentials: await storeCursor(credential) });
  models.setProvider(createCursorProvider());
  const result = await models.refresh({ allowNetwork: true, providers: ['cursor'] });
  expect(result.errors.get('cursor')?.message).toBe('Cursor rejected the session (HTTP 401). Run /login and choose Cursor.');
  expect(result.errors.get('cursor')?.message).not.toContain('cursor-secret');
});

test('a Cursor prompt keeps the system prompt and each speaker and leaves out thinking', () => {
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
  const prompt = promptFrom([
    { role: 'system', content: 'You are a test.', sections: { tools: '<tools>read</tools>', gone: null }, timestamp: 0 },
    { role: 'user', content: 'What is 2+2?', timestamp: 1 },
    {
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'secret chain of thought' },
        { type: 'text', text: '4' },
      ],
      api: 'cursor-agent',
      provider: 'cursor',
      model: 'composer-2.5',
      usage,
      stopReason: 'stop',
      timestamp: 2,
    },
    {
      role: 'user',
      content: [
        { type: 'text', text: 'Now read file.txt' },
        { type: 'image', data: 'AAAA', mimeType: 'image/png' },
      ],
      timestamp: 3,
    },
    { role: 'toolResult', toolCallId: 't1', toolName: 'read', content: [{ type: 'text', text: 'FILE CONTENTS' }], isError: false, timestamp: 4 },
  ]);
  expect(prompt).toBe(['System:\nYou are a test.\n\n<tools>read</tools>', 'User:\nWhat is 2+2?', 'Assistant:\n4', 'User:\nNow read file.txt\n[image not sent]', 'Tool result (read):\nFILE CONTENTS'].join('\n\n'));
});
