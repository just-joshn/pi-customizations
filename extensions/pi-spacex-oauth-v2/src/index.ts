import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { CURSOR_PROVIDER_ID, cursorProvider } from './cursor/provider.ts';
import { GROK_PROVIDER_ID, grokProvider } from './grok.ts';
import { fetchCursorAccount, fetchGrokBilling, formatGrokBilling, formatRateLimit, parseRateLimit, type RateLimit } from './usage.ts';

const STATUS_KEY = 'spacex-usage';

export default function piSpacexOauth(pi: ExtensionAPI) {
  pi.registerProvider(GROK_PROVIDER_ID, grokProvider);
  pi.registerProvider(CURSOR_PROVIDER_ID, cursorProvider);

  let grokRateLimit: RateLimit | undefined;

  const token = async (ctx: ExtensionContext, provider: string) => (await ctx.modelRegistry.getProviderAuth(provider))?.auth.apiKey;

  async function usageLines(ctx: ExtensionContext): Promise<string[]> {
    const [cursorToken, grokToken] = await Promise.all([token(ctx, CURSOR_PROVIDER_ID), token(ctx, GROK_PROVIDER_ID)]);
    const lines = await Promise.all([cursorToken ? fetchCursorAccount(cursorToken) : undefined, grokToken ? fetchGrokBilling(grokToken).then(formatGrokBilling) : undefined]);
    if (grokRateLimit) lines.push(formatRateLimit(grokRateLimit));
    return lines.filter((l): l is string => !!l);
  }

  /** Grok Build's remaining requests while a Grok Build model is selected. */
  function refreshStatus(ctx: ExtensionContext) {
    if (!ctx.hasUI) return;
    const show = ctx.model?.provider === GROK_PROVIDER_ID && grokRateLimit;
    ctx.ui.setStatus(STATUS_KEY, show ? ctx.ui.theme.fg('dim', `${grokRateLimit?.remainingRequests} req left`) : undefined);
  }

  pi.on('session_start', (_e, ctx) => refreshStatus(ctx));
  pi.on('model_select', (_e, ctx) => refreshStatus(ctx));
  pi.on('turn_end', (_e, ctx) => refreshStatus(ctx));
  pi.on('after_provider_response', (e, ctx) => {
    if (ctx.model?.provider === GROK_PROVIDER_ID) grokRateLimit = parseRateLimit(e.headers) ?? grokRateLimit;
  });

  pi.registerCommand('spacex-usage', {
    description: 'Show X subscription usage for Grok Build and the signed-in Cursor account',
    handler: async (_args, ctx) => {
      const lines = await usageLines(ctx).catch((err: unknown) => [`Usage lookup failed: ${err instanceof Error ? err.message : String(err)}`]);
      ctx.ui.notify(lines.length > 0 ? lines.join('\n') : 'Sign in with /login (Grok Build or Cursor) to see usage.', 'info');
    },
  });
}
