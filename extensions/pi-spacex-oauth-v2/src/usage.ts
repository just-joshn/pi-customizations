import { Cursor } from '@cursor/sdk';
import { z } from 'zod';
import { GROK_BASE_URL, GROK_HEADERS } from './grok.ts';

const TOKENS_PER_MILLION = 1e6;

const BillingResponse = z.object({
  config: z.object({ used: z.object({ val: z.number().nullish() }).nullish(), billingPeriodEnd: z.string().nullish() }).nullish(),
});

export interface GrokBilling {
  creditsUsed: number;
  periodEnd: number;
}

export interface RateLimit {
  remainingRequests: number;
  limitRequests: number;
  remainingTokens: number;
  limitTokens: number;
}

/** The SDK has no plan-usage read, so Cursor reports which account the key belongs to. */
export async function fetchCursorAccount(apiKey: string): Promise<string> {
  const me = await Cursor.me({ apiKey });
  return `Cursor: signed in as ${me.userEmail ?? me.apiKeyName}. See cursor.com/dashboard/usage for plan usage.`;
}

export async function fetchGrokBilling(grokToken: string): Promise<GrokBilling> {
  const res = await fetch(`${GROK_BASE_URL}/billing`, { headers: { Authorization: `Bearer ${grokToken}`, ...GROK_HEADERS } });
  if (!res.ok) throw new Error(`Grok billing failed: HTTP ${res.status}`);
  const body = BillingResponse.parse(await res.json());
  return { creditsUsed: body.config?.used?.val ?? 0, periodEnd: Date.parse(body.config?.billingPeriodEnd ?? '') || 0 };
}

export function parseRateLimit(headers: Record<string, string>): RateLimit | undefined {
  const n = (k: string) => Number(headers[k]);
  const limit = { remainingRequests: n('x-ratelimit-remaining-requests'), limitRequests: n('x-ratelimit-limit-requests'), remainingTokens: n('x-ratelimit-remaining-tokens'), limitTokens: n('x-ratelimit-limit-tokens') };
  return Object.values(limit).every(Number.isFinite) ? limit : undefined;
}

const when = (ms: number) => new Date(ms).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export const formatGrokBilling = (b: GrokBilling) => `Grok Build credits used: ${b.creditsUsed}, period ends ${when(b.periodEnd)}`;
const millions = (tokens: number) => `${(tokens / TOKENS_PER_MILLION).toFixed(1)}M`;

export const formatRateLimit = (r: RateLimit) => `Grok Build rate limit: ${r.remainingRequests}/${r.limitRequests} requests, ${millions(r.remainingTokens)}/${millions(r.limitTokens)} tokens left`;
