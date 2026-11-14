import { randomUUID } from 'node:crypto';

import type { FetchFunction } from '@earendil-works/pi-ai';
import { attestBody } from './attestation.ts';
import { mergeBetas } from './identity.ts';
import { rememberRequestId } from './request-session.ts';

const MESSAGES_PATH = '/v1/messages';

function pathOf(input: Parameters<FetchFunction>[0]): string {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  try {
    return new URL(raw).pathname;
  } catch {
    return raw;
  }
}

export function attestingFetch(base: FetchFunction, sessionId: string | undefined): FetchFunction {
  return async (input, init) => {
    if (!pathOf(input).endsWith(MESSAGES_PATH)) return base(input, init);
    const headers = new Headers(init?.headers);
    headers.set('anthropic-beta', mergeBetas(headers.get('anthropic-beta')));
    if (!headers.has('x-client-request-id')) headers.set('x-client-request-id', randomUUID());
    const body = typeof init?.body === 'string' ? attestBody(init.body) : init?.body;
    const response = await base(input, { ...init, headers, ...(body === undefined || body === null ? {} : { body }) });
    rememberRequestId({ sessionId, requestId: response.headers.get('request-id') });
    return response;
  };
}
