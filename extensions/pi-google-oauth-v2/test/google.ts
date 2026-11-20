import { vi } from 'vitest';
import { LOOPBACK_ORIGIN } from './constants.ts';
import { parseJsonBody } from './json-body.ts';

/** What Google received. `json` and `form` are set when the body was JSON or a URL-encoded form. */
export interface GoogleRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  json: Record<string, unknown> | undefined;
  form: URLSearchParams | undefined;
}

/** Answers one request. `attempt` counts earlier requests that matched the same route. */
export type Responder = (request: GoogleRequest, attempt: number) => Response | Promise<Response>;

/** Maps a URL fragment to the responder that answers requests whose URL contains it. */
export type Routes = Readonly<Record<string, Responder>>;

type FetchInput = string | URL | Request;

const toUrl = (input: FetchInput): string => (input instanceof Request ? input.url : String(input));

const toRequest = (input: FetchInput, init: RequestInit | undefined): GoogleRequest => ({
  url: toUrl(input),
  method: init?.method ?? 'GET',
  headers: Object.fromEntries(new Headers(init?.headers)),
  json: typeof init?.body === 'string' ? parseJsonBody(init.body) : undefined,
  form: init?.body instanceof URLSearchParams ? init.body : undefined,
});

export const json = (body: unknown, status?: number): Response => Response.json(body, status === undefined ? {} : { status });

export const respondWith =
  (response: () => Response): Responder =>
  () =>
    response();

/**
 * Replaces the global fetch with a fake Google. Requests to the loopback sign-in listener still reach
 * the real network stack so a real server can be driven. Any other unrouted request fails the test.
 */
export function installGoogle(routes: Routes) {
  const realFetch = globalThis.fetch;
  const matching = (url: string): string | undefined => Object.keys(routes).find((fragment) => url.includes(fragment));
  const fetchImpl = vi.fn(async (input: FetchInput, init?: RequestInit): Promise<Response> => {
    const url = toUrl(input);
    if (url.startsWith(LOOPBACK_ORIGIN)) return realFetch(input, init);
    const fragment = matching(url);
    const responder = fragment === undefined ? undefined : routes[fragment];
    if (fragment === undefined || responder === undefined) throw new Error(`unexpected request to ${url}`);
    const attempt = fetchImpl.mock.calls.filter(([earlier]) => toUrl(earlier).includes(fragment)).length - 1;
    return responder(toRequest(input, init), attempt);
  });
  vi.stubGlobal('fetch', fetchImpl);
  const requestsTo = (fragment: string): GoogleRequest[] => fetchImpl.mock.calls.filter(([input]) => toUrl(input).includes(fragment)).map(([input, init]) => toRequest(input, init));
  return {
    fetchImpl,
    requestsTo,
    get requests(): GoogleRequest[] {
      return fetchImpl.mock.calls.filter(([input]) => !toUrl(input).startsWith(LOOPBACK_ORIGIN)).map(([input, init]) => toRequest(input, init));
    },
  };
}

export type GoogleFake = ReturnType<typeof installGoogle>;
