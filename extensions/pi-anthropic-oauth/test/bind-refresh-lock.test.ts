import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createModels, InMemoryCredentialStore } from '@earendil-works/pi-ai';
import { expect, onTestFinished, vi } from 'vitest';
import extension, { bindSubscriptionRefreshLock } from '../src/index.ts';
import { refreshClaimDirectoryFor } from '../src/refresh-claim.ts';
import { test } from './network-guard.ts';
import { ask } from './support/context.ts';
import { oauthCredential, REFRESHED_ACCESS_TOKEN, REFRESHED_REFRESH_TOKEN } from './support/credentials.ts';
import { captureProvider } from './support/load-extension.ts';
import { errorReply, type RecordedRequest, sseReply, startMessagesServer } from './support/messages-server.ts';
import { collect } from './support/run-stream.ts';
import { textMessage } from './support/sse.ts';
import { TOKEN_URL } from './support/token-endpoint.ts';

const agentDir = vi.hoisted(() => {
  const state = { current: '' };
  const getAgentDir = vi.fn(() => {
    if (state.current === '') throw new Error('test agent dir is not set');
    return state.current;
  });
  return { state, getAgentDir };
});

vi.mock(import('@earendil-works/pi-coding-agent'), async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, getAgentDir: agentDir.getAgentDir };
});

function authorization(request: RecordedRequest): string | undefined {
  const value = request.headers.authorization;
  return Array.isArray(value) ? value[0] : value;
}

async function claimDuringFetch(directory: string): Promise<'present' | 'absent'> {
  try {
    return (await readdir(directory)).length > 0 ? 'present' : 'absent';
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'absent';
    throw error;
  }
}

async function refreshWithoutStore(networkGuard: typeof fetch, bind: () => void): Promise<{ claimDuringRefresh: 'present' | 'absent'; sharePath: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'pi-anth-bind-lock-'));
  onTestFinished(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  agentDir.state.current = dir;
  agentDir.getAgentDir.mockClear();
  const provider = captureProvider(extension);
  if (agentDir.getAgentDir.mock.calls.length === 0) throw new Error('getAgentDir mock did not intercept the extension default path');

  const credential = oauthCredential();
  const toAuth = provider.auth.oauth?.toAuth;
  if (!toAuth) throw new Error('provider oauth toAuth is missing');
  await toAuth(credential);
  bind();

  const authPath = join(dir, 'auth.json');
  const claimDirectory = refreshClaimDirectoryFor(authPath);
  const sharePath = join(dir, 'claude-subscription-refresh.json');
  let tokenRequests = 0;
  let claimDuringRefresh: 'present' | 'absent' | undefined;
  vi.stubGlobal('fetch', async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url !== TOKEN_URL) return networkGuard(input, init);
    init?.signal?.throwIfAborted();
    claimDuringRefresh = await claimDuringFetch(claimDirectory);
    tokenRequests += 1;
    return Response.json({ access_token: REFRESHED_ACCESS_TOKEN, refresh_token: REFRESHED_REFRESH_TOKEN, expires_in: 3600 });
  });

  const credentials = new InMemoryCredentialStore();
  await credentials.modify(provider.id, async () => credential);
  const models = createModels({ credentials });
  models.setProvider(provider);
  const model = models.getModel(provider.id, 'claude-sonnet-4-6');
  if (!model) throw new Error('model claude-subscription/claude-sonnet-4-6 is not registered');
  const server = await startMessagesServer(sseReply(textMessage('ok')));
  onTestFinished(() => server.close());
  server.respond((res, request) => {
    if (authorization(request) === `Bearer ${credential.access}`) {
      errorReply(401, 'invalid bearer token')(res, request);
      return;
    }
    sseReply(textMessage('ok'))(res, request);
  });

  const { message } = await collect(models.streamSimple({ ...model, baseUrl: server.baseUrl }, ask('hi'), { maxRetries: 0 }));
  expect(message.stopReason).toBe('stop');
  expect(server.requests).toHaveLength(2);
  expect(tokenRequests).toBe(1);
  if (claimDuringRefresh === undefined) throw new Error('token refresh did not observe the claims directory');
  return { claimDuringRefresh, sharePath };
}

test('bindSubscriptionRefreshLock(undefined) skips the refresh claim and writes no share file', async ({ networkGuard }) => {
  const result = await refreshWithoutStore(networkGuard, () => {
    bindSubscriptionRefreshLock(undefined);
  });
  expect(result.claimDuringRefresh).toBe('absent');
  await expect(stat(result.sharePath)).rejects.toMatchObject({ code: 'ENOENT' });
});

test('bindSubscriptionRefreshLock() keeps the refresh claim and writes the share file', async ({ networkGuard }) => {
  const result = await refreshWithoutStore(networkGuard, () => {
    bindSubscriptionRefreshLock(undefined);
    bindSubscriptionRefreshLock();
  });
  expect(result.claimDuringRefresh).toBe('present');
  expect(JSON.parse(await readFile(result.sharePath, 'utf8'))).toMatchObject({ access: REFRESHED_ACCESS_TOKEN });
});
