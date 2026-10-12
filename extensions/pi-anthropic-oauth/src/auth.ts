import type { ApiKeyAuth, AuthResult, OAuthAuth, ProviderAuth, ProviderEnv } from '@earendil-works/pi-ai';

// Measured Claude Code 2.1.296 order. ANTHROPIC_OAUTH_TOKEN is a lower-priority alias that CLI does not consult.
const TOKEN_VARIABLES: readonly string[] = ['ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_OAUTH_TOKEN'];
const OAUTH_ACCESS_TOKEN = /^sk-ant-oat01-[A-Za-z0-9_-]+$/;

function tokenAuth(value: string, source: string, env?: ProviderEnv): AuthResult | undefined {
  if (!value) return undefined;
  const token = value.trim();
  if (!OAUTH_ACCESS_TOKEN.test(token)) throw new Error(`${source} must contain a Claude OAuth access token, not an API key.`);
  return { auth: { apiKey: token }, ...(env === undefined ? {} : { env }), source };
}

const subscriptionToken: ApiKeyAuth = {
  name: 'Claude subscription token',
  resolve: async ({ ctx, credential, signal }) => {
    signal.throwIfAborted();
    if (credential?.key !== undefined) return tokenAuth(credential.key, 'stored credential', credential.env);
    for (const source of TOKEN_VARIABLES) {
      const value = await ctx.env(source);
      signal.throwIfAborted();
      if (value) return tokenAuth(value, source);
    }
    return undefined;
  },
};

export function subscriptionAuth(oauth: OAuthAuth): ProviderAuth {
  return {
    apiKey: subscriptionToken,
    oauth: {
      ...oauth,
      name: 'Claude subscription (Provider CLI)',
      login: async (interaction, options) => {
        interaction.signal.throwIfAborted();
        try {
          return await oauth.login(interaction, options);
        } catch (error) {
          interaction.signal.throwIfAborted();
          // Pi backs out of /login only when the error message is exactly this.
          if (error instanceof Error && error.message === 'Login cancelled') throw error;
          throw new Error('Claude subscription login failed. Try /login again.');
        }
      },
      refresh: async (credential, signal) => {
        signal.throwIfAborted();
        try {
          return await oauth.refresh(credential, signal);
        } catch {
          signal.throwIfAborted();
          throw new Error('Claude subscription token refresh failed. Retry or use /login to sign in again.');
        }
      },
    },
  };
}
