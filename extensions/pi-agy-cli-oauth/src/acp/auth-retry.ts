import { z } from 'zod';
import type { AcpClient, AcpRequestOptions } from './client.ts';
import { AUTH_REQUIRED_CODE } from './protocol.ts';
import { AUTH_RETRIES, AUTH_RETRY_DELAY_MS } from '../constants.ts';

const FAILURE = z.object({ code: z.number(), message: z.string() });

/**
 * `initialize` and `session/new` answer with this code until the CLI's keyring read
 * finishes, and again forever when the account is signed out. Retrying is the only
 * way to tell the two apart, and the retry budget is what bounds the second case.
 */
export function isAuthRequired(error: unknown): boolean {
  const direct = FAILURE.safeParse(error);
  return direct.success && direct.data.code === AUTH_REQUIRED_CODE;
}

export function abortError(signal: AbortSignal | undefined): Error {
  return signal?.reason instanceof Error ? signal.reason : new Error('Aborted');
}

export function delay(ms: number, signal: AbortSignal | undefined): Promise<void> {
  if (signal?.aborted === true) return Promise.reject(abortError(signal));
  return new Promise((resolve, reject) => {
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(abortError(signal));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * One handshake call, retried while the CLI reports that authentication is still
 * pending. Every turn and every probe goes through this, so no caller can be the
 * one that gives up on the keyring race.
 */
export async function requestWithAuthRetry<T>(client: AcpClient, method: string, params: unknown, options?: AcpRequestOptions): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await client.request<T>(method, params, options);
    } catch (error: unknown) {
      if (!isAuthRequired(error) || attempt >= AUTH_RETRIES || options?.signal?.aborted === true) throw error;
      await delay(AUTH_RETRY_DELAY_MS, options?.signal);
    }
  }
}
