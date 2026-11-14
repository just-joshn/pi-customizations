import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { FetchFunction, OAuthAuth, OAuthCredential } from '@earendil-works/pi-ai';
import { expect, onTestFinished, test, vi } from 'vitest';
import type { RefreshClaimOptions } from '../src/refresh-claim.ts';
import { refreshingClient } from './support/oauth-client.ts';
import { hostStoreUnavailable, noRotationLog } from './support/recovery.ts';

vi.mock(import('node:fs/promises'), async (importOriginal) => {
  const real = await importOriginal();
  const yieldingLikeSeparateProcesses = Object.fromEntries(
    Object.entries(real).map(([name, value]) => [
      name,
      typeof value === 'function'
        ? async (...args: unknown[]) => {
            for (let turns = Math.floor(Math.random() * 8); turns > 0; turns -= 1) {
              await new Promise((resolve) => setImmediate(resolve));
            }
            const result: unknown = Reflect.apply(value, undefined, args);
            return result;
          }
        : value,
    ]),
  );
  return { ...real, ...yieldingLikeSeparateProcesses, default: { ...real, ...yieldingLikeSeparateProcesses } };
});

const { createAuthRecovery } = await import('../src/auth-recovery.ts');
const { subscriptionAuth } = await import('../src/auth.ts');
const { refreshClaimDirectoryFor } = await import('../src/refresh-claim.ts');

const URL = 'https://api.anthropic.invalid/v1/messages';

function staleCredential(): OAuthCredential {
  return { type: 'oauth', access: 'old-access', refresh: 'old-refresh', expires: Date.now() + 3_600_000 };
}

function recoveryFor(oauth: Pick<OAuthAuth, 'refresh'>, authPath: string, lock: RefreshClaimOptions) {
  let recovery: ReturnType<typeof createAuthRecovery> | undefined;
  const auth = subscriptionAuth(refreshingClient(oauth.refresh), {
    onCredential: (credential, rotation) => recovery?.remember(credential, rotation),
    rotation: { directory: () => refreshClaimDirectoryFor(authPath), claimOptions: lock },
  });
  recovery = createAuthRecovery({ providerId: 'claude-subscription', oauth: auth.oauth, recorded: noRotationLog, stored: hostStoreUnavailable });
  recovery.remember(staleCredential());
  return recovery;
}

const baseFetch: FetchFunction = async (_input, init) => {
  const authorization = new Headers(init?.headers).get('authorization');
  return new Response('', { status: authorization === 'Bearer old-access' ? 401 : 200 });
};

test.for(Array.from({ length: 10 }, (_, trial) => trial))('recoveries that take over from a crashed refresher send the refresh token once (trial %i)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pi-anth-takeover-'));
  onTestFinished(() => rm(dir, { recursive: true, force: true }));
  const authPath = join(dir, 'auth.json');
  const lock = { retries: 10_000, retryDelayMs: () => Math.random() * 2, staleMs: 30 };

  let crash: () => void = () => {};
  const crashed = new Promise<never>((_resolve, reject) => {
    crash = () => reject(new Error('refresher crashed before sending'));
  });
  let crasherEntered = false;
  const crasher = recoveryFor(
    {
      refresh: () => {
        crasherEntered = true;
        return crashed;
      },
    },
    authPath,
    lock,
  );
  const crasherResponse = crasher.wrapFetch(baseFetch)(URL, { headers: { authorization: 'Bearer old-access' } });
  await vi.waitFor(() => {
    if (!crasherEntered) throw new Error('the crashing refresher has not started');
  });

  const sentRefreshTokens: string[] = [];
  const oauth = {
    refresh: async (credential: OAuthCredential) => {
      sentRefreshTokens.push(credential.refresh);
      return { ...credential, access: 'new-access', refresh: 'new-refresh', expires: Date.now() + 3_600_000 };
    },
  };
  const survivors = Array.from({ length: 8 }, () => recoveryFor(oauth, authPath, lock).wrapFetch(baseFetch));
  const responses = await Promise.all(survivors.map((fetch) => fetch(URL, { headers: { authorization: 'Bearer old-access' } })));
  crash();
  await crasherResponse;

  expect(sentRefreshTokens).toStrictEqual(['old-refresh']);
  expect(responses.map((response) => response.status)).toStrictEqual(Array(8).fill(200));
});
