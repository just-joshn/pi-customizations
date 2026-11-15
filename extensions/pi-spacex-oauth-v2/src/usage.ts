import { CURSOR_API } from './cursor/auth.ts';
import { cursorHeaders } from './cursor/models.ts';
import { GROK_BASE_URL, GROK_HEADERS } from './grok.ts';

export interface PlanUsage {
  plan: string;
  percentUsed: number;
  resetsAt: number;
}

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

async function cursorRpc<T>(token: string, method: string): Promise<T> {
  const res = await fetch(`${CURSOR_API}/aiserver.v1.DashboardService/${method}`, {
    method: 'POST',
    headers: { ...cursorHeaders(token), 'content-type': 'application/json', 'connect-protocol-version': '1' },
    body: '{}',
  });
  if (!res.ok) throw new Error(`Cursor ${method} failed: HTTP ${res.status}`);
  return (await res.json()) as T;
}

/** The merged X/Cursor plan allowance, which Cursor reports for the whole subscription. */
export async function fetchPlanUsage(cursorToken: string): Promise<PlanUsage> {
  const [usage, plan] = await Promise.all([
    cursorRpc<{ billingCycleEnd?: string; planUsage?: { totalPercentUsed?: number } }>(cursorToken, 'GetCurrentPeriodUsage'),
    cursorRpc<{ planInfo?: { planName?: string; includedUsageResetsAt?: string } }>(cursorToken, 'GetPlanInfo'),
  ]);
  return {
    plan: plan.planInfo?.planName ?? 'Cursor',
    percentUsed: usage.planUsage?.totalPercentUsed ?? 0,
    resetsAt: Number(plan.planInfo?.includedUsageResetsAt ?? usage.billingCycleEnd ?? 0),
  };
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

export const formatPlan = (u: PlanUsage) => `${u.plan}: ${u.percentUsed.toFixed(1)}% of included usage, resets ${when(u.resetsAt)}`;
export const formatGrokBilling = (b: GrokBilling) => `Grok Build credits used: ${b.creditsUsed}, period ends ${when(b.periodEnd)}`;
export const formatRateLimit = (r: RateLimit) => `Grok Build rate limit: ${r.remainingRequests}/${r.limitRequests} requests, ${(r.remainingTokens / 1e6).toFixed(1)}M/${(r.limitTokens / 1e6).toFixed(1)}M tokens left`;
