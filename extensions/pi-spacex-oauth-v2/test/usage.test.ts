import { expect, test } from 'vitest';
import { parseRateLimit } from '../src/usage.ts';

const LIMIT_TOKENS = 53_000_000;
const REMAINING_TOKENS = 52_000_000;
const LIMIT_REQUESTS = 8300;
const REMAINING_REQUESTS = 8299;

test("parses Grok's rate-limit headers", () => {
  const headers = {
    'x-ratelimit-limit-tokens': String(LIMIT_TOKENS),
    'x-ratelimit-remaining-tokens': String(REMAINING_TOKENS),
    'x-ratelimit-limit-requests': String(LIMIT_REQUESTS),
    'x-ratelimit-remaining-requests': String(REMAINING_REQUESTS),
  };
  expect(parseRateLimit(headers)).toStrictEqual({
    remainingRequests: REMAINING_REQUESTS,
    limitRequests: LIMIT_REQUESTS,
    remainingTokens: REMAINING_TOKENS,
    limitTokens: LIMIT_TOKENS,
  });
});

test('ignores responses without rate-limit headers', () => {
  expect(parseRateLimit({ 'content-type': 'text/event-stream' })).toBeUndefined();
});
