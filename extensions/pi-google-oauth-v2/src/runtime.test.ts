import { type Credential, createModels, InMemoryCredentialStore, type MutableModels, type Provider } from '@earendil-works/pi-ai';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { parseJsonBody } from '../test/json-body.ts';
import { ANTIGRAVITY_USER_AGENT, PRIVATE_PROJECT_HEADER, PROVIDER_ID } from './constants.ts';
import extension from './index.ts';

const STREAM_URL = 'https://daily-cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const HTTP_OK = 200;
const HTTP_BAD_REQUEST = 400;
const PROMPT_TOKENS = 120;
const CACHED_TOKENS = 20;
const CANDIDATE_TOKENS = 30;
const THOUGHT_TOKENS = 10;
const TOTAL_TOKENS = 160;
const CREDENTIAL_TTL_MS = 3_600_000;
const NEAR_EXPIRY_MS = 1_000;
const REFRESHED_EXPIRES_IN_SECONDS = 3600;

const sse = (...chunks: object[]) => new Response(chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join(''), { status: HTTP_OK, headers: { 'Content-Type': 'text/event-stream' } });

const reply = sse(
  { response: { candidates: [{ content: { role: 'model', parts: [{ thought: true, text: 'Need the file.' }] } }] }, traceId: 'trace-9' },
  { response: { candidates: [{ content: { role: 'model', parts: [{ text: 'Reading it now.' }] } }] } },
  {
    response: {
      candidates: [{ content: { role: 'model', parts: [{ functionCall: { id: 'call-1', name: 'read', args: { path: 'a.ts' } } }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: PROMPT_TOKENS, cachedContentTokenCount: CACHED_TOKENS, candidatesTokenCount: CANDIDATE_TOKENS, thoughtsTokenCount: THOUGHT_TOKENS, totalTokenCount: TOTAL_TOKENS },
      modelVersion: 'gemini-3.8-flash-001',
    },
  },
);

function runtime(credential: Credential) {
  const registerProvider = vi.fn<(provider: Provider) => void>();
  extension({ registerProvider } as unknown as ExtensionAPI);
  const credentials = new InMemoryCredentialStore();
  const models: MutableModels = createModels({ credentials });
  const provider = registerProvider.mock.calls[0]?.[0];
  if (!provider) throw new Error('extension registered no provider');
  models.setProvider(provider);
  const model = models.getModel(PROVIDER_ID, 'gemini-3.8-flash');
  if (!model) throw new Error('model missing');
  return credentials.modify(PROVIDER_ID, async () => credential).then(() => ({ models, model, credentials }));
}

interface Seen {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

function recordingFetch(response: Response) {
  const fetchImpl = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => response);
  return {
    fetchImpl,
    get seen(): Seen[] {
      return fetchImpl.mock.calls.map(([input, init]) => ({ url: String(input), headers: Object.fromEntries(new Headers(init?.headers)), body: parseJsonBody(init?.body) }));
    },
  };
}

const context = {
  messages: [
    { role: 'system' as const, content: 'Be brief.', timestamp: 1 },
    { role: 'user' as const, content: 'Read a.ts', timestamp: 1 },
  ],
};

afterEach(() => vi.unstubAllGlobals());

describe('real Pi Models runtime', () => {
  test('streams a Code Assist reply through Models.streamSimple', async () => {
    const { models, model } = await runtime({ type: 'oauth', access: 'access-live', refresh: 'refresh-live', expires: Date.now() + CREDENTIAL_TTL_MS, projectId: 'proj-77' });
    const google = recordingFetch(reply);

    const message = await models.streamSimple(model, context, { fetch: google.fetchImpl, reasoning: 'xhigh', sessionId: 'sess-9' }).result();

    expect(google.seen).toHaveLength(1);
    expect(google.seen[0]?.url).toBe(STREAM_URL);
    expect(google.seen[0]?.headers['authorization']).toBe('Bearer access-live');
    expect(google.seen[0]?.headers['user-agent']).toBe(ANTIGRAVITY_USER_AGENT);
    expect(google.seen[0]?.body).toMatchObject({
      project: 'proj-77',
      model: 'gemini-3.8-flash-high',
      userAgent: 'antigravity',
      requestType: 'agent',
      request: { sessionId: 'sess-9', systemInstruction: { role: 'user' }, generationConfig: { thinkingConfig: { includeThoughts: true, thinkingLevel: 'HIGH' } } },
    });
    expect(google.seen[0]?.body['requestId']).toEqual(expect.any(String));
    expect(Object.keys(google.seen[0]?.headers ?? {})).not.toContain(PRIVATE_PROJECT_HEADER);
    expect(Object.values(google.seen[0]?.headers ?? {}).join('\n')).not.toContain('proj-77');
    expect(message).toMatchObject({ stopReason: 'toolUse', responseId: 'trace-9', responseModel: 'gemini-3.8-flash-001' });
    expect(message.content).toEqual([
      { type: 'thinking', thinking: 'Need the file.' },
      { type: 'text', text: 'Reading it now.' },
      { type: 'toolCall', id: 'call-1', name: 'read', arguments: { path: 'a.ts' } },
    ]);
    expect(message.usage).toMatchObject({ input: PROMPT_TOKENS - CACHED_TOKENS, output: CANDIDATE_TOKENS + THOUGHT_TOKENS, cacheRead: CACHED_TOKENS, reasoning: THOUGHT_TOKENS, totalTokens: TOTAL_TOKENS });
    expect(message.usage.cost.total).toBe(0);
  });
});

describe('real Pi Models runtime refresh', () => {
  test('refreshes a near-expiry credential and keeps its projectId', async () => {
    const { models, model, credentials } = await runtime({ type: 'oauth', access: 'access-old', refresh: 'refresh-live', expires: Date.now() + NEAR_EXPIRY_MS, projectId: 'proj-77' });
    const tokenFetch = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => Response.json({ access_token: 'access-refreshed', expires_in: REFRESHED_EXPIRES_IN_SECONDS }));
    vi.stubGlobal('fetch', tokenFetch);
    const google = recordingFetch(sse({ response: { candidates: [{ content: { role: 'model', parts: [{ text: 'ok' }] }, finishReason: 'STOP' }] } }));

    const message = await models.streamSimple(model, context, { fetch: google.fetchImpl }).result();

    const tokenRequests = tokenFetch.mock.calls.map(([input, init]) => `${String(input)} ${String(init?.body)}`);
    expect(tokenRequests).toHaveLength(1);
    expect(tokenRequests[0]).toContain(TOKEN_URL);
    expect(tokenRequests[0]).toContain('refresh_token=refresh-live');
    expect(google.seen[0]?.headers['authorization']).toBe('Bearer access-refreshed');
    expect(google.seen[0]?.body['project']).toBe('proj-77');
    expect(message.stopReason).toBe('stop');
    expect(await credentials.read(PROVIDER_ID)).toMatchObject({ type: 'oauth', access: 'access-refreshed', refresh: 'refresh-live', projectId: 'proj-77' });
  });

  test('surfaces a failed refresh as an error and keeps the stored credential', async () => {
    const { models, model, credentials } = await runtime({ type: 'oauth', access: 'access-old', refresh: 'refresh-live', expires: Date.now() + NEAR_EXPIRY_MS, projectId: 'proj-77' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ error: 'invalid_grant' }, { status: HTTP_BAD_REQUEST })),
    );
    const google = recordingFetch(reply);

    const message = await models.streamSimple(model, context, { fetch: google.fetchImpl }).result();

    expect(message.stopReason).toBe('error');
    expect(google.fetchImpl).not.toHaveBeenCalled();
    expect(await credentials.read(PROVIDER_ID)).toMatchObject({ access: 'access-old', projectId: 'proj-77' });
  });
});
