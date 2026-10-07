import type { ExtensionCommandContext } from '@earendil-works/pi-coding-agent';
import { PROVIDER_ID, parseApiKey, postCloudCode } from './cloudcode.ts';
import { fetchEmail, LOAD_CODE_ASSIST_BODY, type OAuthEndpoints } from './oauth.ts';

export interface QuotaBucket {
  displayName: string;
  remainingFraction?: number | undefined;
  resetTime?: string | undefined;
}

export interface QuotaGroup {
  displayName: string;
  buckets: QuotaBucket[];
}

export interface AccountSummary {
  email?: string | undefined;
  projectId: string;
  tier?: string | undefined;
  quota: QuotaGroup[];
  quotaError?: string | undefined;
}

function tierName(data: unknown): string | undefined {
  const { paidTier, currentTier } = (data ?? {}) as Record<string, { name?: unknown; id?: unknown } | undefined>;
  for (const tier of [paidTier, currentTier]) {
    const name = typeof tier?.name === 'string' ? tier.name : undefined;
    const id = typeof tier?.id === 'string' ? tier.id : undefined;
    if (name || id) return name && id ? `${name} (${id})` : (name ?? id);
  }
  return undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export function parseQuotaSummary(data: unknown): QuotaGroup[] {
  const groups = (data as { groups?: unknown } | null)?.groups;
  if (!Array.isArray(groups)) return [];
  return groups.map((group: { displayName?: unknown; buckets?: unknown }) => ({
    displayName: text(group?.displayName) ?? 'Models',
    buckets: (Array.isArray(group?.buckets) ? group.buckets : []).map((bucket: { displayName?: unknown; remainingFraction?: unknown; resetTime?: unknown }) => ({
      displayName: text(bucket?.displayName) ?? 'Limit',
      remainingFraction: typeof bucket?.remainingFraction === 'number' ? bucket.remainingFraction : undefined,
      resetTime: text(bucket?.resetTime),
    })),
  }));
}

/** Budget for the account command's three lookups, so a stalled connection cannot hold the command open indefinitely. */
const accountLookupTimeoutMs = 30_000;

export async function fetchAccountSummary(apiKey: string, endpoints: Pick<OAuthEndpoints, 'cloudCode' | 'userInfoUrl'>): Promise<AccountSummary> {
  const { token, projectId } = parseApiKey(apiKey);
  const signal = AbortSignal.timeout(accountLookupTimeoutMs);
  const [email, assist, quota] = await Promise.all([
    fetchEmail(endpoints.userInfoUrl, token, signal),
    postCloudCode(endpoints.cloudCode, 'loadCodeAssist', token, LOAD_CODE_ASSIST_BODY, signal).catch(() => undefined),
    postCloudCode(endpoints.cloudCode, 'retrieveUserQuotaSummary', token, { project: projectId }, signal).then(
      (data): { groups: QuotaGroup[]; error?: string } => ({ groups: parseQuotaSummary(data) }),
      (error: unknown) => ({ groups: [], error: error instanceof Error ? error.message : String(error) }),
    ),
  ]);
  return { email, projectId, tier: tierName(assist), quota: quota.groups, quotaError: quota.error };
}

function formatReset(resetTime: string | undefined, now: number): string {
  const at = resetTime ? Date.parse(resetTime) : Number.NaN;
  if (Number.isNaN(at)) return '';
  const minutes = Math.max(0, Math.round((at - now) / 60000));
  const hours = Math.floor(minutes / 60);
  return `, resets in ${hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes}m`}`;
}

export function formatAccountSummary(summary: AccountSummary, now = Date.now()): string {
  const lines = [`Account: ${summary.email ?? 'unknown'}`, `Project: ${summary.projectId}`, `Tier: ${summary.tier ?? 'unknown'}`, 'Quota:'];
  if (summary.quotaError) lines.push(`  unavailable: ${summary.quotaError}`);
  else if (summary.quota.length === 0) lines.push('  no quota returned');
  for (const group of summary.quota) {
    lines.push(`  ${group.displayName}:`);
    for (const bucket of group.buckets) {
      const left = bucket.remainingFraction === undefined ? 'unknown' : `${Math.round(bucket.remainingFraction * 100)}% left`;
      lines.push(`    ${bucket.displayName}: ${left}${formatReset(bucket.resetTime, now)}`);
    }
  }
  return lines.join('\n');
}

export function createAntigravityCommand(endpoints: Pick<OAuthEndpoints, 'cloudCode' | 'userInfoUrl'>) {
  const report = (ctx: ExtensionCommandContext, text: string, level: 'info' | 'error') => {
    if (ctx.hasUI) ctx.ui.notify(text, level);
    else process.stderr.write(`${text}\n`);
  };
  return {
    description: 'Show the Google Antigravity account, project, tier, and quota',
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      const apiKey = await ctx.modelRegistry.getApiKeyForProvider(PROVIDER_ID);
      if (!apiKey) {
        report(ctx, 'Google Antigravity is not logged in. Run /login and choose Google Antigravity.', 'error');
        return;
      }
      try {
        report(ctx, formatAccountSummary(await fetchAccountSummary(apiKey, endpoints)), 'info');
      } catch (error) {
        report(ctx, error instanceof Error ? error.message : String(error), 'error');
      }
    },
  };
}
