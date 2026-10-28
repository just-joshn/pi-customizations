import type { ApiKeyAuth, AuthEvent, AuthResult, OAuthAuth, ProviderAuth, ProviderAuthInteraction, ProviderEnv } from '@earendil-works/pi-ai';

const CLAUDE_CODE_TOKEN_VARIABLES: readonly string[] = ['ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN'];
const ANTHROPIC_OAUTH_TOKEN_ALIAS = 'ANTHROPIC_OAUTH_TOKEN';
const AMBIENT_TOKEN_VARIABLES: readonly string[] = [...CLAUDE_CODE_TOKEN_VARIABLES, ANTHROPIC_OAUTH_TOKEN_ALIAS];
const OAUTH_ACCESS_TOKEN = /^sk-ant-oat01-[A-Za-z0-9_-]+$/;

export const CLAUDE_AUTHORIZE_ORIGIN = 'https://claude.com';
export const CLAUDE_AUTHORIZE_PATH = '/cai/oauth/authorize';
export const CLAUDE_OAUTH_SCOPES = 'org:create_api_key user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload user:plugins';
const CLAUDE_COPY_CODE_LOGIN = 'copy_code';

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
    for (const source of AMBIENT_TOKEN_VARIABLES) {
      const value = await ctx.env(source);
      signal.throwIfAborted();
      if (value) return tokenAuth(value, source);
    }
    return undefined;
  },
};

export function rewriteClaudeAuthorizeUrl(url: string): string {
  const parsed = new URL(url);
  const next = new URL(`${CLAUDE_AUTHORIZE_ORIGIN}${CLAUDE_AUTHORIZE_PATH}`);
  next.search = parsed.search;
  next.searchParams.set('scope', CLAUDE_OAUTH_SCOPES);
  return next.toString();
}

function withForcedPasteCodeLogin(interaction: ProviderAuthInteraction): ProviderAuthInteraction {
  return {
    signal: interaction.signal,
    prompt: async (prompt) => {
      // Answer only the method option Pi offers, so a selector for something else
      // reaches the user instead of being answered with a stale id.
      if (prompt.type === 'select' && prompt.options.some((option) => option.id === CLAUDE_COPY_CODE_LOGIN)) return CLAUDE_COPY_CODE_LOGIN;
      return interaction.prompt(prompt);
    },
    notify: (event: AuthEvent) => {
      if (event.type === 'auth_url') {
        interaction.notify({ ...event, url: rewriteClaudeAuthorizeUrl(event.url) });
        return;
      }
      interaction.notify(event);
    },
  };
}

export function subscriptionAuth(oauth: OAuthAuth): ProviderAuth {
  return {
    apiKey: subscriptionToken,
    oauth: {
      ...oauth,
      name: 'Claude subscription (Provider CLI)',
      loginLabel: 'Claude subscription (Provider CLI)',
      login: async (interaction, options) => {
        interaction.signal.throwIfAborted();
        try {
          return await oauth.login(withForcedPasteCodeLogin(interaction), options);
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
