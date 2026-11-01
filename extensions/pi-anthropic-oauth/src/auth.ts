import type { ApiKeyAuth, AuthResult, OAuthAuth, OAuthCredential, ProviderAuth, ProviderEnv } from '@earendil-works/pi-ai';
import { createClaudeOAuth, LOGIN_CANCELLED, LOGIN_TIMED_OUT } from './oauth.ts';

export {
  CLAUDE_AUTHORIZE_ORIGIN,
  CLAUDE_AUTHORIZE_PATH,
  CLAUDE_AUTHORIZE_QUERY_ORDER,
  CLAUDE_AUTHORIZE_URL,
  CLAUDE_COPY_CODE_REDIRECT_URI,
  CLAUDE_LOGIN_SCOPES,
  CLAUDE_OAUTH_CLIENT_ID,
  CLAUDE_OAUTH_SCOPES,
  CLAUDE_REFRESH_SCOPE,
  CLAUDE_REFRESH_SCOPES,
  CLAUDE_TOKEN_URL,
  LOGIN_CANCELLED,
  LOGIN_TIMED_OUT,
  buildAuthorizeUrl,
  createClaudeOAuth,
  createPkcePair,
} from './oauth.ts';

const AMBIENT_TOKEN_VARIABLES: readonly string[] = ['ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN'];
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
    for (const source of AMBIENT_TOKEN_VARIABLES) {
      const value = await ctx.env(source);
      signal.throwIfAborted();
      if (value) return tokenAuth(value, source);
    }
    return undefined;
  },
};

function wrapLoginErrors(oauth: OAuthAuth): OAuthAuth['login'] {
  return async (interaction, options) => {
    interaction.signal.throwIfAborted();
    try {
      return await oauth.login(interaction, options);
    } catch (error) {
      interaction.signal.throwIfAborted();
      if (error instanceof Error && error.message === LOGIN_CANCELLED) throw error;
      if (error instanceof Error && error.message === LOGIN_TIMED_OUT) throw error;
      if (error instanceof Error && /Claude Code credentials/.test(error.message)) throw error;
      throw new Error('Claude subscription login failed. Try /login again.');
    }
  };
}

export {
  CLAUDE_CREDENTIALS_FILENAME,
  CLAUDE_KEYCHAIN_SERVICE_DEFAULT,
  claudeConfigDir,
  claudeCredentialsPath,
  claudeKeychainAccount,
  claudeKeychainService,
  importClaudeAiOauth,
  parseClaudeCredentialsJson,
  resolveClaudeCredentialsLayout,
  toPiOAuthCredential,
} from './claude-credentials.ts';

function wrapRefreshErrors(oauth: OAuthAuth): OAuthAuth['refresh'] {
  return async (credential, signal) => {
    signal.throwIfAborted();
    try {
      return await oauth.refresh(credential, signal);
    } catch {
      signal.throwIfAborted();
      throw new Error('Claude subscription token refresh failed. Retry or use /login to sign in again.');
    }
  };
}

export type SubscriptionAuthOptions = {
  onCredential?: (credential: OAuthCredential) => void;
};

export function subscriptionAuth(oauth: OAuthAuth = createClaudeOAuth(), options: SubscriptionAuthOptions = {}): ProviderAuth {
  const refresh = wrapRefreshErrors(oauth);
  return {
    apiKey: subscriptionToken,
    oauth: {
      ...oauth,
      name: 'Claude subscription (Provider CLI)',
      loginLabel: 'Claude subscription (Provider CLI)',
      login: wrapLoginErrors(oauth),
      refresh: async (credential, signal) => {
        const next = await refresh(credential, signal);
        options.onCredential?.(next);
        return next;
      },
      toAuth: async (credential) => {
        options.onCredential?.(credential);
        return oauth.toAuth(credential);
      },
    },
  };
}

export type { ClaudeOAuthOptions } from './oauth.ts';
