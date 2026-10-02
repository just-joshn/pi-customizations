import { vi } from 'vitest';
import { PROXY_BASE_URL } from '../../src/catalog.ts';

export const MODELS_URL = `${PROXY_BASE_URL}/models`;

export type CatalogRequest = { readonly url: string; readonly authorization: string | null };

export type CatalogEndpoint = { readonly requests: readonly CatalogRequest[] };

function urlOf(input: Parameters<typeof fetch>[0]): string {
  return input instanceof Request ? input.url : String(input);
}

export function stubCatalogEndpoint(reply: () => Response): CatalogEndpoint {
  const delegate = globalThis.fetch;
  const requests: CatalogRequest[] = [];
  const answer: typeof fetch = async (input, init) => {
    if (urlOf(input) !== MODELS_URL) return delegate(input, init);
    requests.push({ url: MODELS_URL, authorization: new Headers(init?.headers).get('authorization') });
    return reply();
  };
  vi.stubGlobal('fetch', answer);
  return {
    get requests() {
      return [...requests];
    },
  };
}
