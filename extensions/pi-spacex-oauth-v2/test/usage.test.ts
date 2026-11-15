import { expect, test } from 'vitest';
import { formatPlan, parseRateLimit } from '../src/usage.ts';

test("parses Grok's rate-limit headers", () => {
  expect(parseRateLimit({ 'x-ratelimit-limit-tokens': '53000000', 'x-ratelimit-remaining-tokens': '52000000', 'x-ratelimit-limit-requests': '8300', 'x-ratelimit-remaining-requests': '8299' })).toStrictEqual({
    remainingRequests: 8299,
    limitRequests: 8300,
    remainingTokens: 52000000,
    limitTokens: 53000000,
  });
});

test('ignores responses without rate-limit headers', () => {
  expect(parseRateLimit({ 'content-type': 'text/event-stream' })).toBeUndefined();
});

test('formats plan usage with percent and reset time', () => {
  const text = formatPlan({ plan: 'Super', percentUsed: 0.0743, resetsAt: Date.UTC(2026, 10, 22, 10, 21) });
  expect(text).toMatch(/^Super: 0\.1% of included usage, resets /);
  expect(text).toContain('Nov');
});
