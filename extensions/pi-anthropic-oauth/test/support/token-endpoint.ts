import { vi } from 'vitest';
import { REFRESHED_ACCESS_TOKEN, REFRESHED_REFRESH_TOKEN } from './credentials.ts';

export const TOKEN_URL = 'https://platform.claude.com/v1/oauth/token';

export interface TokenRequest {
  readonly url: string;
  readonly body: unknown;
}

export interface TokenEndpoint {
  readonly requests: readonly TokenRequest[];
}

function urlOf(input: Parameters<typeof fetch>[0]): string {
  return input instanceof Request ? input.url : String(input);
}

// Answers the OAuth token URL at the HTTP boundary and hands every other URL to the
// fetch that was installed before, which is the repository's network guard.
export function stubTokenEndpoint(): TokenEndpoint {
  const delegate = globalThis.fetch;
  const requests: TokenRequest[] = [];
  const answer: typeof fetch = async (input, init) => {
    if (urlOf(input) !== TOKEN_URL) return delegate(input, init);
    init?.signal?.throwIfAborted();
    const body: unknown = JSON.parse(String(init?.body));
    requests.push({ url: TOKEN_URL, body });
    return Response.json({ access_token: REFRESHED_ACCESS_TOKEN, refresh_token: REFRESHED_REFRESH_TOKEN, expires_in: 3600 });
  };
  vi.stubGlobal('fetch', answer);
  return {
    get requests() {
      return [...requests];
    },
  };
}
