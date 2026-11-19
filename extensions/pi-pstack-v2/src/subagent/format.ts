import type { UsageStats } from './types.ts';

const COST_DECIMALS = 4;
const THOUSAND = 1000;
const TEN_THOUSAND = 10_000;
const MILLION = 1_000_000;

export function formatTokens(count: number): string {
  if (count < THOUSAND) return count.toString();
  if (count < TEN_THOUSAND) return `${(count / THOUSAND).toFixed(1)}k`;
  if (count < MILLION) return `${Math.round(count / THOUSAND)}k`;
  return `${(count / MILLION).toFixed(1)}M`;
}

type UsageInput = Omit<UsageStats, 'contextTokens' | 'turns'> & Partial<Pick<UsageStats, 'contextTokens' | 'turns'>>;

export function formatUsageStats(usage: UsageInput, model?: string): string {
  const parts = [
    usage.turns ? `${usage.turns} turn${usage.turns > 1 ? 's' : ''}` : '',
    usage.input ? `↑${formatTokens(usage.input)}` : '',
    usage.output ? `↓${formatTokens(usage.output)}` : '',
    usage.cacheRead ? `R${formatTokens(usage.cacheRead)}` : '',
    usage.cacheWrite ? `W${formatTokens(usage.cacheWrite)}` : '',
    usage.cost ? `$${usage.cost.toFixed(COST_DECIMALS)}` : '',
    usage.contextTokens && usage.contextTokens > 0 ? `ctx:${formatTokens(usage.contextTokens)}` : '',
    model ?? '',
  ];
  return parts.filter(Boolean).join(' ');
}
