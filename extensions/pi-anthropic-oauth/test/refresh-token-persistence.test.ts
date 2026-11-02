import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FetchFunction, OAuthAuth, OAuthCredential } from '@earendil-works/pi-ai';
import { createModels, createProvider } from '@earendil-works/pi-ai/models';
import { AuthStorage } from '../node_modules/@earendil-works/pi-coding-agent/dist/core/auth-storage.js';
import { expect, onTestFinished, test } from 'vitest';
import { subscriptionAuth } from '../src/auth.ts';
import { createAuthRecovery } from '../src/auth-recovery.ts';
import { refreshClaimDirectoryFor } from '../src/refresh-claim.ts';

const PROVIDER_ID = 'claude-subscription';
const HOUR = 3_600_000;

function oauthServer(lifetimeMs = 8 * HOUR, firstRotationLifetimeMs = lifetimeMs) {
  let generation = 1;
  const reused: string[] = [];
  const oauth = {
    login: async () => {
      throw new Error('login is not part of this test');
    },
    refresh: async (credential: OAuthCredential) => {
      if (credential.refresh !== `refresh-${generation}`) {
        reused.push(credential.refresh);
        throw new Error('invalid_grant: refresh token reused');
      }
      generation += 1;
      return { type: 'oauth', access: `access-${generation}`, refresh: `refresh-${generation}`, expires: Date.now() + (generation === 2 ? firstRotationLifetimeMs : lifetimeMs) };
    },
    toAuth: async (credential: OAuthCredential) => ({ apiKey: credential.access }),
  } as unknown as OAuthAuth;
  const currentAccess = () => `access-${generation}`;
  return { oauth, reused, currentAccess };
}

test('an expiry refresh after a 401 recovery never resends the rotated refresh token', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pi-anth-persist-'));
  onTestFinished(() => rm(dir, { recursive: true, force: true }));
  const authPath = join(dir, 'auth.json');
  const store = AuthStorage.create(authPath);
  await store.modify(PROVIDER_ID, async () => ({ type: 'oauth', access: 'access-1', refresh: 'refresh-1', expires: Date.now() + 30 * 60_000 }));
  const server = oauthServer();
  let recovery: ReturnType<typeof createAuthRecovery> | undefined;
  const auth = subscriptionAuth(server.oauth, {
    onCredential: (credential) => recovery?.remember(credential),
    rotation: { directory: () => refreshClaimDirectoryFor(authPath) },
  });
  recovery = createAuthRecovery({ providerId: PROVIDER_ID, oauth: auth.oauth as OAuthAuth });
  const models = createModels({ credentials: store });
  models.setProvider(createProvider({ id: PROVIDER_ID, auth, models: [], api: { stream: () => { throw new Error('not streamed'); }, streamSimple: () => { throw new Error('not streamed'); } } } as unknown as Parameters<typeof createProvider>[0]));
  const revokedFirstAccess: FetchFunction = async (_input, init) => {
    const authorization = new Headers(init?.headers).get('authorization');
    return new Response('', { status: authorization === 'Bearer access-1' ? 401 : 200 });
  };

  await models.getAuth(PROVIDER_ID);
  const recovered = await recovery.wrapFetch(revokedFirstAccess)('https://api.anthropic.invalid/v1/messages', {
    headers: { authorization: 'Bearer access-1' },
  });
  const afterExpiry = await models.getAuth(PROVIDER_ID, { minOAuthValidityMs: HOUR }).catch((error: unknown) => error);

  expect(recovered.status).toBe(200);
  expect(server.reused).toStrictEqual([]);
  expect(afterExpiry).toMatchObject({ auth: { apiKey: server.currentAccess() } });
});

test('a bearer token export after a 401 recovery gets a token valid for its 30 minute window', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pi-anth-persist-'));
  onTestFinished(() => rm(dir, { recursive: true, force: true }));
  const authPath = join(dir, 'auth.json');
  const store = AuthStorage.create(authPath);
  await store.modify(PROVIDER_ID, async () => ({ type: 'oauth', access: 'access-1', refresh: 'refresh-1', expires: Date.now() + 30 * 60_000 }));
  const server = oauthServer(8 * HOUR, 20 * 60_000);
  let recovery: ReturnType<typeof createAuthRecovery> | undefined;
  const auth = subscriptionAuth(server.oauth, {
    onCredential: (credential) => recovery?.remember(credential),
    rotation: { directory: () => refreshClaimDirectoryFor(authPath) },
  });
  recovery = createAuthRecovery({ providerId: PROVIDER_ID, oauth: auth.oauth as OAuthAuth });
  const models = createModels({ credentials: store });
  models.setProvider(createProvider({ id: PROVIDER_ID, auth, models: [], api: { stream: () => { throw new Error('not streamed'); }, streamSimple: () => { throw new Error('not streamed'); } } } as unknown as Parameters<typeof createProvider>[0]));
  const revokedFirstAccess: FetchFunction = async (_input, init) => {
    const authorization = new Headers(init?.headers).get('authorization');
    return new Response('', { status: authorization === 'Bearer access-1' ? 401 : 200 });
  };

  await models.getAuth(PROVIDER_ID);
  const recovered = await recovery.wrapFetch(revokedFirstAccess)('https://api.anthropic.invalid/v1/messages', {
    headers: { authorization: 'Bearer access-1' },
  });
  const exported = await models.getAuth(PROVIDER_ID, { minOAuthValidityMs: 30 * 60_000 }).catch((error: unknown) => error);

  expect(recovered.status).toBe(200);
  expect(server.reused).toStrictEqual([]);
  expect(exported).toMatchObject({ auth: { apiKey: server.currentAccess() } });
});

test('a recovery holding an already rotated token refreshes the newest token after it expired', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pi-anth-persist-'));
  onTestFinished(() => rm(dir, { recursive: true, force: true }));
  const authPath = join(dir, 'auth.json');
  const server = oauthServer(20);
  const original: OAuthCredential = { type: 'oauth', access: 'access-1', refresh: 'refresh-1', expires: Date.now() + HOUR };
  const lock = { staleMs: 1, retries: 0 };
  const revokedFirstAccess: FetchFunction = async (_input, init) => {
    const authorization = new Headers(init?.headers).get('authorization');
    const usable = authorization === `Bearer ${server.currentAccess()}` && authorization !== 'Bearer access-1';
    return new Response('', { status: usable ? 200 : 401 });
  };
  const recoveries = [0, 1].map(() => {
    let recovery: ReturnType<typeof createAuthRecovery> | undefined;
    const auth = subscriptionAuth(server.oauth, {
      onCredential: (credential) => recovery?.remember(credential),
      rotation: { directory: () => refreshClaimDirectoryFor(authPath), claimOptions: lock },
    });
    recovery = createAuthRecovery({ providerId: PROVIDER_ID, oauth: auth.oauth as OAuthAuth });
    recovery.remember(original);
    return recovery.wrapFetch(revokedFirstAccess);
  });

  const first = await recoveries[0]!('https://api.anthropic.invalid/v1/messages', { headers: { authorization: 'Bearer access-1' } });
  const rotatedExpires = Date.now() + 20;
  await expect.poll(() => Date.now() > rotatedExpires + 5).toBe(true);
  const second = await recoveries[1]!('https://api.anthropic.invalid/v1/messages', { headers: { authorization: 'Bearer access-1' } });

  expect(first.status).toBe(200);
  expect(server.reused).toStrictEqual([]);
  expect(second.status).toBe(200);
});
