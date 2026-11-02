import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FetchFunction, OAuthAuth, OAuthCredential } from '@earendil-works/pi-ai';
import { expect, onTestFinished, test, vi } from 'vitest';

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
            return (value as (...values: unknown[]) => unknown)(...args);
          }
        : value,
    ]),
  );
  return { ...real, ...yieldingLikeSeparateProcesses, default: { ...real, ...yieldingLikeSeparateProcesses } } as typeof real;
});

const { createAuthRecovery } = await import('../src/auth-recovery.ts');

const URL = 'https://api.anthropic.invalid/v1/messages';

function staleCredential(): OAuthCredential {
  return { type: 'oauth', access: 'old-access', refresh: 'old-refresh', expires: Date.now() + 3_600_000 };
}

const baseFetch: FetchFunction = async (_input, init) => {
  const authorization = new Headers(init?.headers).get('authorization');
  return new Response('', { status: authorization === 'Bearer old-access' ? 401 : 200 });
};

test.for(Array.from({ length: 10 }, (_, trial) => trial))(
  'recoveries that take over from a crashed refresher send the refresh token once (trial %i)',
  async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pi-anth-takeover-'));
    onTestFinished(() => rm(dir, { recursive: true, force: true }));
    const authPath = join(dir, 'auth.json');
    const lock = { retries: 10_000, retryDelayMs: () => Math.random() * 2, staleMs: 30 };

    let crash: () => void = () => {};
    const crashed = new Promise<never>((_resolve, reject) => {
      crash = () => reject(new Error('refresher crashed before sending'));
    });
    let crasherEntered = false;
    const crasher = createAuthRecovery({
      providerId: 'claude-subscription',
      oauth: {
        refresh: () => {
          crasherEntered = true;
          return crashed;
        },
      } as unknown as OAuthAuth,
      refreshLockTarget: authPath,
      refreshLockOptions: lock,
    });
    crasher.remember(staleCredential());
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
    } as unknown as OAuthAuth;
    const survivors = Array.from({ length: 8 }, () => {
      const recovery = createAuthRecovery({ providerId: 'claude-subscription', oauth, refreshLockTarget: authPath, refreshLockOptions: lock });
      recovery.remember(staleCredential());
      return recovery.wrapFetch(baseFetch);
    });
    const responses = await Promise.all(survivors.map((fetch) => fetch(URL, { headers: { authorization: 'Bearer old-access' } })));
    crash();
    await crasherResponse;

    expect(sentRefreshTokens).toStrictEqual(['old-refresh']);
    expect(responses.map((response) => response.status)).toStrictEqual(Array(8).fill(200));
  },
);
