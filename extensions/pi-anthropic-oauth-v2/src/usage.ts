import type { ExtensionAPI, ExtensionCommandContext } from '@earendil-works/pi-coding-agent';

type UsageRow = { title: string; percent: number; resetsAt: unknown; severity: unknown };

const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
const RELOGIN = 'Run /login and choose Anthropic (Claude subscription, OAuth).';
const GROUP_TITLES: Record<string, string> = { session: 'Current session', weekly: 'Current week' };
// Servers that predate limits[] send only these windows.
const WINDOWS = [
  ['five_hour', 'Current session'],
  ['seven_day', 'Current week (all models)'],
  ['seven_day_sonnet', 'Current week (Sonnet)'],
  ['seven_day_opus', 'Current week (Opus)'],
] as const;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const displayName = (value: unknown) => (isRecord(value) && typeof value['display_name'] === 'string' ? value['display_name'] : undefined);

function limitRow(limit: unknown): UsageRow[] {
  if (!isRecord(limit) || typeof limit['percent'] !== 'number') return [];
  const group = String(limit['group']);
  const base = GROUP_TITLES[group] ?? group;
  const scope = isRecord(limit['scope']) ? (displayName(limit['scope']['model']) ?? displayName(limit['scope']['surface'])) : undefined;
  const title = scope ? `${base} (${scope})` : limit['kind'] === 'weekly_all' ? `${base} (all models)` : base;
  return [{ title, percent: limit['percent'], resetsAt: limit['resets_at'], severity: limit['severity'] }];
}

function parseUsage(body: unknown): UsageRow[] | undefined {
  if (!isRecord(body)) return undefined;
  const limits = body['limits'];
  if (Array.isArray(limits)) return limits.flatMap(limitRow);
  if (limits !== undefined && limits !== null) return undefined;
  return WINDOWS.flatMap(([key, title]) => {
    const window = body[key];
    return isRecord(window) && typeof window['utilization'] === 'number' ? [{ title, percent: window['utilization'], resetsAt: window['resets_at'], severity: 'normal' }] : [];
  });
}

function resetsIn(resetsAt: unknown): string {
  const at = typeof resetsAt === 'string' ? Date.parse(resetsAt) : Number.NaN;
  if (Number.isNaN(at)) return '';
  const minutes = Math.max(0, Math.round((at - Date.now()) / 60_000));
  const days = Math.floor(minutes / 1_440);
  const hours = Math.floor((minutes % 1_440) / 60);
  const left = days > 0 ? `${days}d ${hours}h ${minutes % 60}m` : hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
  return `, resets in ${left}`;
}

const formatRow = (row: UsageRow) => `${row.title}: ${Number(row.percent.toFixed(1))}% used${resetsIn(row.resetsAt)}`;

async function fetchUsage(token: string): Promise<UsageRow[]> {
  const response = await fetch(USAGE_URL, {
    headers: { Authorization: `Bearer ${token}`, 'anthropic-beta': 'oauth-2025-04-20' },
    signal: AbortSignal.timeout(30_000),
  });
  if (response.status === 401 || response.status === 403) throw new Error(`Claude rejected the login (HTTP ${response.status}). ${RELOGIN}`);
  if (!response.ok) throw new Error(`Claude usage check failed (HTTP ${response.status}).`);
  const rows = parseUsage(await response.json().catch(() => undefined));
  if (!rows) throw new Error('Claude returned usage Pi cannot read.');
  return rows;
}

function report(ctx: ExtensionCommandContext, text: string, level: 'info' | 'warning' | 'error') {
  if (ctx.hasUI) ctx.ui.notify(text, level);
  else process.stderr.write(`${text}\n`);
}

export function createUsageCommand(providerId: string): Parameters<ExtensionAPI['registerCommand']>[1] {
  return {
    description: 'Show Claude subscription usage limits',
    handler: async (_args, ctx) => {
      try {
        const token = (await ctx.modelRegistry.getProviderAuth(providerId))?.auth.apiKey;
        if (!token?.startsWith('sk-ant-oat')) return report(ctx, `Claude is not logged in. ${RELOGIN}`, 'error');
        const rows = await fetchUsage(token);
        if (rows.length === 0) return report(ctx, 'Claude reported no usage limits for this plan.', 'info');
        const level = rows.some((row) => row.severity !== 'normal') ? 'warning' : 'info';
        report(ctx, rows.map(formatRow).join('\n'), level);
      } catch (error) {
        report(ctx, error instanceof Error ? error.message : String(error), 'error');
      }
    },
  };
}
