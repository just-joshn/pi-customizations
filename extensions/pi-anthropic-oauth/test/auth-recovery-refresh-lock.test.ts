import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FetchFunction, OAuthAuth, OAuthCredential } from '@earendil-works/pi-ai';
import { AuthStorage } from '../node_modules/@earendil-works/pi-coding-agent/dist/core/auth-storage.js';
import { expect, onTestFinished, test, vi } from 'vitest';
import { subscriptionAuth } from '../src/auth.ts';
import { createAuthRecovery } from '../src/auth-recovery.ts';
import { type RefreshClaimOptions, refreshClaimDirectoryFor } from '../src/refresh-claim.ts';

const PROVIDER_ID = 'claude-subscription';

function staleCredential(): OAuthCredential {
  return {
    type: 'oauth',
    access: 'old-access',
    refresh: 'old-refresh',
    expires: Date.now() + 3_600_000,
  };
}

function rotated(credential: OAuthCredential): OAuthCredential {
  return {
    ...credential,
    access: 'new-access',
    refresh: 'new-refresh',
    expires: Date.now() + 3_600_000,
  };
}

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'pi-anth-recovery-lock-'));
  onTestFinished(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  return dir;
}

function recoveryFor(oauth: OAuthAuth, authPath: string, claimOptions?: RefreshClaimOptions) {
  let recovery: ReturnType<typeof createAuthRecovery> | undefined;
  const auth = subscriptionAuth(oauth, {
    onCredential: (credential) => recovery?.remember(credential),
    rotation: { directory: () => refreshClaimDirectoryFor(authPath), ...(claimOptions === undefined ? {} : { claimOptions }) },
  });
  recovery = createAuthRecovery({ providerId: PROVIDER_ID, oauth: auth.oauth as OAuthAuth });
  recovery.remember(staleCredential());
  return recovery;
}

function fetching(posts: { count: number }, holdFirst: Promise<void>, onFirst?: () => Promise<void>): OAuthAuth['refresh'] {
  return async (credential) => {
    posts.count += 1;
    if (posts.count === 1) {
      await onFirst?.();
      await holdFirst;
    }
    return rotated(credential);
  };
}

function baseFetch(): FetchFunction {
  return async (_input, init) => {
    const authorization = new Headers(init?.headers).get('authorization');
    return new Response('', { status: authorization === 'Bearer old-access' ? 401 : 200 });
  };
}

test('two recoveries on one auth file send one refresh POST and both retry 200', async () => {
  const dir = await tempDir();
  const authPath = join(dir, 'auth.json');
  const storeA = AuthStorage.create(authPath);
  await storeA.modify(PROVIDER_ID, async () => staleCredential());
  const storeB = AuthStorage.create(authPath);
  const posts = { count: 0 };
  let release: () => void = () => {};
  const holdFirst = new Promise<void>((resolve) => {
    release = resolve;
  });
  const oauth = { refresh: fetching(posts, holdFirst) } as unknown as OAuthAuth;
  const lock = { retries: 200, retryDelayMs: () => 5 };
  const signal = AbortSignal.timeout(3_000);
  const recoveries = [storeA, storeB].map((store) => {
    const recovery = recoveryFor(oauth, authPath, lock);
    recovery.bindCredentials(store);
    return recovery.wrapFetch(baseFetch());
  });
  const pending = Promise.all(recoveries.map((fetch) => fetch('https://api.anthropic.invalid/v1/messages', { headers: { authorization: 'Bearer old-access' }, signal })));
  await vi.waitFor(() => {
    if (posts.count < 1) throw new Error('refresh has not started');
  });
  release();
  const responses = await pending;
  expect(responses.map((response) => response.status)).toStrictEqual([200, 200]);
  expect(posts.count).toBe(1);
  await expect(storeB.read(PROVIDER_ID)).resolves.toMatchObject({ access: 'new-access', refresh: 'new-refresh' });
});

test('AuthStorage refresh completes beside the rotation log', async () => {
  const dir = await tempDir();
  const authPath = join(dir, 'auth.json');
  const store = AuthStorage.create(authPath);
  await store.modify(PROVIDER_ID, async () => staleCredential());
  const posts = { count: 0 };
  const oauth = {
    refresh: async (credential: OAuthCredential) => {
      posts.count += 1;
      return rotated(credential);
    },
  } as unknown as OAuthAuth;
  const recovery = recoveryFor(oauth, authPath);
  recovery.bindCredentials(store);
  const response = await recovery.wrapFetch(baseFetch())('https://api.anthropic.invalid/v1/messages', {
    headers: { authorization: 'Bearer old-access' },
    signal: AbortSignal.timeout(3_000),
  });
  expect(response.status).toBe(200);
  expect(posts.count).toBe(1);
});

test('two recoveries without a store send one refresh POST under one claim', async () => {
  const dir = await tempDir();
  const authPath = join(dir, 'auth.json');
  const posts = { count: 0 };
  let release: () => void = () => {};
  const holdFirst = new Promise<void>((resolve) => {
    release = resolve;
  });
  const oauth = {
    refresh: fetching(posts, holdFirst, async () => {
      await expect(stat(join(dir, 'auth.json.lock'))).rejects.toMatchObject({ code: 'ENOENT' });
    }),
  } as unknown as OAuthAuth;
  const lock = { retries: 200, retryDelayMs: () => 5 };
  const recoveries = [0, 1].map(() => recoveryFor(oauth, authPath, lock).wrapFetch(baseFetch()));
  const pending = Promise.all(
    recoveries.map((fetch) =>
      fetch('https://api.anthropic.invalid/v1/messages', {
        headers: { authorization: 'Bearer old-access' },
        signal: AbortSignal.timeout(3_000),
      }),
    ),
  );
  await vi.waitFor(() => {
    if (posts.count < 1) throw new Error('refresh has not started');
  });
  release();
  const responses = await pending;
  expect(responses.map((response) => response.status)).toStrictEqual([200, 200]);
  expect(posts.count).toBe(1);
  await expect(stat(join(dir, 'auth.json.lock'))).rejects.toMatchObject({ code: 'ENOENT' });
});

test('expired leftover share file still refreshes once and retries 200', async () => {
  const dir = await tempDir();
  const authPath = join(dir, 'auth.json');
  const leftover: OAuthCredential = {
    type: 'oauth',
    access: 'leftover-access',
    refresh: 'leftover-refresh',
    expires: Date.now() - 60_000,
  };
  await writeFile(join(dir, 'claude-subscription-refresh.json'), `${JSON.stringify(leftover)}\n`);
  const posts = { count: 0 };
  const oauth = {
    refresh: async (credential: OAuthCredential) => {
      posts.count += 1;
      return rotated(credential);
    },
  } as unknown as OAuthAuth;
  const recovery = recoveryFor(oauth, authPath);
  const response = await recovery.wrapFetch(async (_input, init) => {
    const authorization = new Headers(init?.headers).get('authorization');
    return new Response('', { status: authorization === 'Bearer new-access' ? 200 : 401 });
  })('https://api.anthropic.invalid/v1/messages', {
    headers: { authorization: 'Bearer old-access' },
    signal: AbortSignal.timeout(3_000),
  });
  expect(posts.count).toBe(1);
  expect(response.status).toBe(200);
});
