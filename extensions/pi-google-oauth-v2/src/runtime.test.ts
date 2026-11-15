import { type Credential, createModels, InMemoryCredentialStore, type MutableModels, type Provider } from '@earendil-works/pi-ai';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { ANTIGRAVITY_USER_AGENT, PRIVATE_PROJECT_HEADER, PROVIDER_ID } from './constants.ts';
import extension from './index.ts';

const sse = (...chunks: object[]) => new Response(chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join(''), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });

const reply = sse(
  { response: { candidates: [{ content: { role: 'model', parts: [{ thought: true, text: 'Need the file.' }] } }] }, traceId: 'trace-9' },
  { response: { candidates: [{ content: { role: 'model', parts: [{ text: 'Reading it now.' }] } }] } },
  {
    response: {
      candidates: [{ content: { role: 'model', parts: [{ functionCall: { id: 'call-1', name: 'read', args: { path: 'a.ts' } } }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 120, cachedContentTokenCount: 20, candidatesTokenCount: 30, thoughtsTokenCount: 10, totalTokenCount: 160 },
      modelVersion: 'gemini-3.8-flash-001',
    },
  },
);

function runtime(credential: Credential) {
  const providers: Provider[] = [];
  extension({ registerProvider: (provider: Provider) => providers.push(provider) } as unknown as ExtensionAPI);
  const credentials = new InMemoryCredentialStore();
  const models: MutableModels = createModels({ credentials });
  const provider = providers[0];
  if (!provider) throw new Error('extension registered no provider');
  models.setProvider(provider);
  const model = models.getModel(PROVIDER_ID, 'gemini-3.8-flash');
  if (!model) throw new Error('model missing');
  return credentials.modify(PROVIDER_ID, async () => credential).then(() => ({ models, model, credentials }));
}

interface Seen {
  url: string;
  headers: Record<string, string>;
  body: { project: string; model: string; requestId: string; userAgent: string; requestType: string; request: { systemInstruction?: { role: string }; generationConfig: { thinkingConfig: unknown } } };
}

function recordingFetch(response: Response) {
  const seen: Seen[] = [];
  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    seen.push({ url: String(input), headers: Object.fromEntries(new Headers(init?.headers)), body: JSON.parse(String(init?.body)) });
    return response;
  });
  return { seen, fetchImpl };
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
    const { models, model } = await runtime({ type: 'oauth', access: 'access-live', refresh: 'refresh-live', expires: Date.now() + 3_600_000, projectId: 'proj-77' });
    const google = recordingFetch(reply);

    const message = await models.streamSimple(model, context, { fetch: google.fetchImpl, reasoning: 'xhigh', sessionId: 'sess-9' }).result();

    expect(google.seen).toHaveLength(1);
    expect(google.seen[0]?.url).toBe('https://daily-cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse');
    expect(google.seen[0]?.headers['authorization']).toBe('Bearer access-live');
    expect(google.seen[0]?.headers['user-agent']).toBe(ANTIGRAVITY_USER_AGENT);
    expect(google.seen[0]?.body).toMatchObject({
      project: 'proj-77',
      model: 'gemini-3.8-flash-high',
      userAgent: 'antigravity',
      requestType: 'agent',
      request: { sessionId: 'sess-9', systemInstruction: { role: 'user' }, generationConfig: { thinkingConfig: { includeThoughts: true, thinkingLevel: 'HIGH' } } },
    });
    expect(google.seen[0]?.body.requestId).toEqual(expect.any(String));
    expect(Object.keys(google.seen[0]?.headers ?? {})).not.toContain(PRIVATE_PROJECT_HEADER);
    expect(Object.values(google.seen[0]?.headers ?? {}).join('\n')).not.toContain('proj-77');
    expect(message).toMatchObject({ stopReason: 'toolUse', responseId: 'trace-9', responseModel: 'gemini-3.8-flash-001' });
    expect(message.content).toEqual([
      { type: 'thinking', thinking: 'Need the file.' },
      { type: 'text', text: 'Reading it now.' },
      { type: 'toolCall', id: 'call-1', name: 'read', arguments: { path: 'a.ts' } },
    ]);
    expect(message.usage).toMatchObject({ input: 100, output: 40, cacheRead: 20, reasoning: 10, totalTokens: 160 });
    expect(message.usage.cost.total).toBe(0);
  });

  test('refreshes a near-expiry credential and keeps its projectId', async () => {
    const { models, model, credentials } = await runtime({ type: 'oauth', access: 'access-old', refresh: 'refresh-live', expires: Date.now() + 1_000, projectId: 'proj-77' });
    const tokenRequests: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        tokenRequests.push(`${String(input)} ${String(init?.body)}`);
        return Response.json({ access_token: 'access-refreshed', expires_in: 3600 });
      }),
    );
    const google = recordingFetch(sse({ response: { candidates: [{ content: { role: 'model', parts: [{ text: 'ok' }] }, finishReason: 'STOP' }] } }));

    const message = await models.streamSimple(model, context, { fetch: google.fetchImpl }).result();

    expect(tokenRequests).toHaveLength(1);
    expect(tokenRequests[0]).toContain('https://oauth2.googleapis.com/token');
    expect(tokenRequests[0]).toContain('refresh_token=refresh-live');
    expect(google.seen[0]?.headers['authorization']).toBe('Bearer access-refreshed');
    expect(google.seen[0]?.body.project).toBe('proj-77');
    expect(message.stopReason).toBe('stop');
    expect(await credentials.read(PROVIDER_ID)).toMatchObject({ type: 'oauth', access: 'access-refreshed', refresh: 'refresh-live', projectId: 'proj-77' });
  });

  test('surfaces a failed refresh as an error and keeps the stored credential', async () => {
    const { models, model, credentials } = await runtime({ type: 'oauth', access: 'access-old', refresh: 'refresh-live', expires: Date.now() + 1_000, projectId: 'proj-77' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ error: 'invalid_grant' }, { status: 400 })),
    );
    const google = recordingFetch(reply);

    const message = await models.streamSimple(model, context, { fetch: google.fetchImpl }).result();

    expect(message.stopReason).toBe('error');
    expect(google.fetchImpl).not.toHaveBeenCalled();
    expect(await credentials.read(PROVIDER_ID)).toMatchObject({ access: 'access-old', projectId: 'proj-77' });
  });
});
