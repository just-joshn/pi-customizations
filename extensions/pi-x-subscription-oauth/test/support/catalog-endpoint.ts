import { vi } from 'vitest';
import { PROXY_BASE_URL } from '../../src/catalog.ts';

export const MODELS_URL = `${PROXY_BASE_URL}/models`;

export type CatalogRequest = { readonly url: string; readonly authorization: string | null; readonly redirect: string | undefined };

export type CatalogEndpoint = { readonly requests: readonly CatalogRequest[] };

function urlOf(input: Parameters<typeof fetch>[0]): string {
  return input instanceof Request ? input.url : String(input);
}

export function stubCatalogEndpoint(reply: () => Response, url: string = MODELS_URL): CatalogEndpoint {
  const delegate = globalThis.fetch;
  const requests: CatalogRequest[] = [];
  const answer = async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]): Promise<Response> => {
    if (urlOf(input) !== url) return delegate(input, init);
    requests.push({ url, authorization: new Headers(init?.headers).get('authorization'), redirect: init?.redirect });
    return reply();
  };
  vi.stubGlobal('fetch', answer);
  return {
    get requests() {
      return [...requests];
    },
  };
}
