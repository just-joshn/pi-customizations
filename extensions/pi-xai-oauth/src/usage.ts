import type { ExtensionAPI, ExtensionCommandContext } from '@earendil-works/pi-coding-agent';
import { PROVIDER_ID, PROXY_BASE_URL } from './catalog.ts';
import { GROK_CLIENT_VERSION } from './request.ts';

export type ProductShare = {
  readonly product: string;
  readonly usagePercent: number;
};

export type PlanPeriod = {
  readonly type?: string;
  readonly start?: string;
  readonly end?: string;
};

export type PlanUsage = {
  readonly usedPercent: number;
  readonly period: PlanPeriod;
  readonly products: readonly ProductShare[];
  readonly prepaid?: number;
  readonly unified?: boolean;
};

export type BillingParse = { readonly kind: 'ok'; readonly usage: PlanUsage } | { readonly kind: 'unreadable' };

export type PlanUsageOptions = {
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
};

const USAGE_TIMEOUT_MS = 30_000;
const WEEKLY = 'USAGE_PERIOD_TYPE_WEEKLY';
const NOT_LOGGED_IN = 'Grok Build is not logged in. Run /login and choose Grok Build.';

function record(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function percent(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) return undefined;
  return value;
}

function productsOf(value: unknown): readonly ProductShare[] | undefined {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return undefined;
  return value.flatMap((row) => {
    const productRow = record(row);
    const product = text(productRow?.['product']);
    const usagePercent = percent(productRow?.['usagePercent']);
    if (!product || usagePercent === undefined) return [];
    return [{ product, usagePercent }];
  });
}

function periodOf(config: Record<string, unknown>): PlanPeriod {
  const current = record(config['currentPeriod']);
  const type = text(current?.['type']);
  const start = text(current?.['start']) ?? text(config['billingPeriodStart']);
  const end = text(current?.['end']) ?? text(config['billingPeriodEnd']);
  return { ...(type ? { type } : {}), ...(start ? { start } : {}), ...(end ? { end } : {}) };
}

export function parseBillingCredits(body: unknown): BillingParse {
  const config = record(record(body)?.['config']);
  if (!config) return { kind: 'unreadable' };
  const usedPercent = percent(config['creditUsagePercent']);
  if (usedPercent === undefined) return { kind: 'unreadable' };
  const products = productsOf(config['productUsage']);
  if (!products) return { kind: 'unreadable' };
  const prepaidRecord = record(config['prepaidBalance']);
  const prepaid = prepaidRecord && typeof prepaidRecord['val'] === 'number' && Number.isFinite(prepaidRecord['val']) ? prepaidRecord['val'] : undefined;
  const unified = typeof config['isUnifiedBillingUser'] === 'boolean' ? config['isUnifiedBillingUser'] : undefined;
  return {
    kind: 'ok',
    usage: {
      usedPercent,
      period: periodOf(config),
      products,
      ...(prepaid !== undefined ? { prepaid } : {}),
      ...(unified !== undefined ? { unified } : {}),
    },
  };
}

function formatPercent(value: number): string {
  const tenths = Math.round(value * 10) / 10;
  return `${Number.isInteger(tenths) ? String(tenths) : tenths.toFixed(1)}%`;
}

function resetsIn(end: string, now: number): string | undefined {
  const at = Date.parse(end);
  if (Number.isNaN(at)) return undefined;
  const minutes = Math.max(0, Math.round((at - now) / 60_000));
  const days = Math.floor(minutes / 1_440);
  const hours = Math.floor((minutes % 1_440) / 60);
  const mins = minutes % 60;
  if (days > 0) return `${days}d ${hours}h ${mins}m`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function periodWord(type: string | undefined): string {
  if (type === WEEKLY) return 'Weekly';
  return type ?? 'Plan';
}

export function formatPlanUsage(usage: PlanUsage, now = Date.now()): string {
  const end = usage.period.end;
  const relative = end ? resetsIn(end, now) : undefined;
  const window = usage.period.start && end ? ` ${usage.period.start} to ${end}` : end ? ` ending ${end}` : '';
  const reset = relative ? `, resets in ${relative}` : '';
  const lines = [`${periodWord(usage.period.type)}${window}: ${formatPercent(usage.usedPercent)} used, ${formatPercent(100 - usage.usedPercent)} left${reset}`];
  if (usage.products.length === 0) lines.push('Products: none');
  for (const product of usage.products) lines.push(`${product.product}: ${formatPercent(product.usagePercent)}`);
  lines.push(`Prepaid: ${usage.prepaid === undefined ? 'unknown' : String(usage.prepaid)}`);
  lines.push(`Unified: ${usage.unified === undefined ? 'unknown' : usage.unified ? 'yes' : 'no'}`);
  return lines.join('\n');
}

export async function fetchPlanUsage(apiKey: string, options?: PlanUsageOptions): Promise<PlanUsage> {
  const response = await (options?.fetch ?? fetch)(`${PROXY_BASE_URL}/billing?format=credits`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'X-XAI-Token-Auth': 'xai-grok-cli',
      Accept: 'application/json',
      'x-grok-client-version': GROK_CLIENT_VERSION,
    },
    redirect: 'error',
    signal: AbortSignal.timeout(options?.timeoutMs ?? USAGE_TIMEOUT_MS),
  });
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) throw new Error(`Grok Build rejected the session (HTTP ${response.status}). Run /login and choose Grok Build.`);
    throw new Error(`Grok Build usage failed (HTTP ${response.status}).`);
  }
  const parsed = parseBillingCredits(await response.json().catch(() => undefined));
  if (parsed.kind === 'unreadable') throw new Error('Grok Build returned usage Pi cannot read.');
  return parsed.usage;
}

function report(ctx: ExtensionCommandContext, text: string, level: 'info' | 'error') {
  if (ctx.hasUI) ctx.ui.notify(text, level);
  else process.stderr.write(`${text}\n`);
}

type UsageCommand = Parameters<ExtensionAPI['registerCommand']>[1];

export function createUsageCommand(): UsageCommand {
  return {
    description: 'Show The X Subscription plan usage for Grok Build',
    handler: async (_args, ctx) => {
      const apiKey = await ctx.modelRegistry.getApiKeyForProvider(PROVIDER_ID);
      if (!apiKey) {
        report(ctx, NOT_LOGGED_IN, 'error');
        return;
      }
      try {
        report(ctx, formatPlanUsage(await fetchPlanUsage(apiKey)), 'info');
      } catch (error) {
        report(ctx, error instanceof Error ? error.message : String(error), 'error');
      }
    },
  };
}
