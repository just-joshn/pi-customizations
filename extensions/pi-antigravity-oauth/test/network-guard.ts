import { test as base, expect, vi } from 'vitest';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

const originalFetch = globalThis.fetch;

function requestUrl(input: Parameters<typeof fetch>[0]): URL {
  if (input instanceof URL) return input;
  if (input instanceof Request) return new URL(input.url);
  return new URL(input);
}

function hostnameOf(url: URL): string {
  return url.hostname.replace(/^\[|\]$/g, '');
}

function guardFetch(input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]): Promise<Response> {
  const url = requestUrl(input);
  if (LOOPBACK_HOSTS.has(hostnameOf(url))) return originalFetch(input, { ...init, redirect: 'error' });
  const test = expect.getState().currentTestName ?? 'unknown test';
  return Promise.reject(new Error(`Blocked external network request to ${url.href} from "${test}"`));
}

export const test = base.extend<{ networkGuard: typeof guardFetch }>({
  networkGuard: [
    // biome-ignore lint/correctness/noEmptyPattern: Vitest requires destructuring to infer fixture dependencies.
    async ({}, use) => {
      vi.stubGlobal('fetch', guardFetch);
      try {
        await use(guardFetch);
      } finally {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        vi.unstubAllEnvs();
        vi.useRealTimers();
      }
    },
    { auto: true },
  ],
});
