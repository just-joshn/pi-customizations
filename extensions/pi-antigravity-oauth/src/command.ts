import type { ExtensionCommandContext } from '@earendil-works/pi-coding-agent';
import { PROVIDER_ID, parseApiKey, postCloudCode } from './cloudcode.ts';
import { type AvailableModel, parseAvailableModels } from './models.ts';
import { fetchEmail, LOAD_CODE_ASSIST_BODY } from './oauth.ts';

export interface CommandEndpoints {
  cloudCode: readonly string[];
  userInfoUrl: string;
}

export interface AccountSummary {
  email?: string;
  projectId: string;
  tier?: string;
  models: AvailableModel[];
  modelsError?: string;
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

export async function fetchAccountSummary(apiKey: string, endpoints: CommandEndpoints): Promise<AccountSummary> {
  const { token, projectId } = parseApiKey(apiKey);
  const [email, assist, available] = await Promise.all([
    fetchEmail(endpoints.userInfoUrl, token),
    postCloudCode(endpoints.cloudCode, 'loadCodeAssist', token, LOAD_CODE_ASSIST_BODY).catch(() => undefined),
    postCloudCode(endpoints.cloudCode, 'fetchAvailableModels', token, { project: projectId }).then(
      (data): { models: AvailableModel[]; error?: string } => ({ models: parseAvailableModels(data) }),
      (error: unknown) => ({ models: [], error: error instanceof Error ? error.message : String(error) }),
    ),
  ]);
  return { email, projectId, tier: tierName(assist), models: available.models, modelsError: available.error };
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
  if (summary.modelsError) lines.push(`  unavailable: ${summary.modelsError}`);
  else if (summary.models.length === 0) lines.push('  no models returned');
  for (const model of summary.models) {
    const left = model.remainingFraction === undefined ? 'unknown' : `${Math.round(model.remainingFraction * 100)}% left`;
    lines.push(`  ${model.id}: ${left}${formatReset(model.resetTime, now)}`);
  }
  return lines.join('\n');
}

export function createAntigravityCommand(endpoints: CommandEndpoints) {
  const report = (ctx: ExtensionCommandContext, text: string, level: 'info' | 'error') => {
    if (ctx.hasUI) ctx.ui.notify(text, level);
    else process.stderr.write(`${text}\n`);
  };
  return {
    description: 'Show the Google Antigravity account, project, tier, and per-model quota',
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
