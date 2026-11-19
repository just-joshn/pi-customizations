import { Cursor } from '@cursor/sdk';
import { GROK_BASE_URL, GROK_HEADERS } from './grok.ts';

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
  const body = (await res.json()) as { config?: { used?: { val?: number }; billingPeriodEnd?: string } };
  return { creditsUsed: body.config?.used?.val ?? 0, periodEnd: Date.parse(body.config?.billingPeriodEnd ?? '') || 0 };
}

export function parseRateLimit(headers: Record<string, string>): RateLimit | undefined {
  const n = (k: string) => Number(headers[k]);
  const limit = { remainingRequests: n('x-ratelimit-remaining-requests'), limitRequests: n('x-ratelimit-limit-requests'), remainingTokens: n('x-ratelimit-remaining-tokens'), limitTokens: n('x-ratelimit-limit-tokens') };
  return Object.values(limit).every(Number.isFinite) ? limit : undefined;
}

const when = (ms: number) => new Date(ms).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export const formatGrokBilling = (b: GrokBilling) => `Grok Build credits used: ${b.creditsUsed}, period ends ${when(b.periodEnd)}`;
export const formatRateLimit = (r: RateLimit) => `Grok Build rate limit: ${r.remainingRequests}/${r.limitRequests} requests, ${(r.remainingTokens / 1e6).toFixed(1)}M/${(r.limitTokens / 1e6).toFixed(1)}M tokens left`;
