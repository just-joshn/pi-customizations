import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { CURSOR_PROVIDER_ID, cursorProvider } from './cursor/provider.ts';
import { GROK_PROVIDER_ID, grokProvider } from './grok.ts';
import { fetchGrokBilling, fetchPlanUsage, formatGrokBilling, formatPlan, formatRateLimit, parseRateLimit, type RateLimit } from './usage.ts';

const PROVIDERS = new Set([GROK_PROVIDER_ID, CURSOR_PROVIDER_ID]);
const STATUS_KEY = 'spacex-usage';
const STATUS_TTL_MS = 60_000;

export default function piSpacexOauth(pi: ExtensionAPI) {
  pi.registerProvider(GROK_PROVIDER_ID, grokProvider);
  pi.registerProvider(CURSOR_PROVIDER_ID, cursorProvider);

  let grokRateLimit: RateLimit | undefined;
  let statusFetchedAt = 0;

  const token = async (ctx: ExtensionContext, provider: string) => (await ctx.modelRegistry.getProviderAuth(provider))?.auth.apiKey;

  async function usageLines(ctx: ExtensionContext): Promise<string[]> {
    const [cursorToken, grokToken] = await Promise.all([token(ctx, CURSOR_PROVIDER_ID), token(ctx, GROK_PROVIDER_ID)]);
    const lines = await Promise.all([cursorToken ? fetchPlanUsage(cursorToken).then(formatPlan) : undefined, grokToken ? fetchGrokBilling(grokToken).then(formatGrokBilling) : undefined]);
    if (grokRateLimit) lines.push(formatRateLimit(grokRateLimit));
    return lines.filter((l): l is string => !!l);
  }

  async function refreshStatus(ctx: ExtensionContext, force = false) {
    if (!ctx.hasUI) return;
    if (!ctx.model || !PROVIDERS.has(ctx.model.provider)) return ctx.ui.setStatus(STATUS_KEY, undefined);
    if (!force && Date.now() - statusFetchedAt < STATUS_TTL_MS) return;
    statusFetchedAt = Date.now();
    const cursorToken = await token(ctx, CURSOR_PROVIDER_ID);
    if (!cursorToken) return ctx.ui.setStatus(STATUS_KEY, grokRateLimit ? ctx.ui.theme.fg('dim', `${grokRateLimit.remainingRequests} req left`) : undefined);
    const usage = await fetchPlanUsage(cursorToken);
    ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg('dim', formatPlan(usage)));
  }

  const safely = (ctx: ExtensionContext, force = false) => refreshStatus(ctx, force).catch(() => ctx.hasUI && ctx.ui.setStatus(STATUS_KEY, undefined));

  pi.on('session_start', (_e, ctx) => void safely(ctx, true));
  pi.on('model_select', (_e, ctx) => void safely(ctx, true));
  pi.on('turn_end', (_e, ctx) => void safely(ctx));
  pi.on('after_provider_response', (e, ctx) => {
    if (ctx.model?.provider === GROK_PROVIDER_ID) grokRateLimit = parseRateLimit(e.headers) ?? grokRateLimit;
  });

  pi.registerCommand('spacex-usage', {
    description: 'Show X subscription usage and reset time for Grok Build and Cursor',
    handler: async (_args, ctx) => {
      const lines = await usageLines(ctx).catch((err: unknown) => [`Usage lookup failed: ${err instanceof Error ? err.message : String(err)}`]);
      ctx.ui.notify(lines.length > 0 ? lines.join('\n') : 'Sign in with /login (Grok Build or Cursor) to see usage.', 'info');
    },
  });
}
