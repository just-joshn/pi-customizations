import type { ApiKeyAuth, AuthContext, AuthResult, OAuthAuth, OAuthCredential, ProviderAuth, ProviderEnv } from '@earendil-works/pi-ai';
import type { CredentialRotation } from './auth-recovery.ts';
import { createClaudeOAuth, isClaudeTokenEndpointError, LOGIN_CANCELLED, LOGIN_TIMED_OUT, PASTE_INVALID_CODE, PASTE_WRONG_SIGNIN } from './oauth.ts';
import { clearRotationLog, isSuccessor, latestRecorded, type RefreshClaimOptions, rotateRefreshToken } from './refresh-claim.ts';
import { type StoredCredential, storedOAuth } from './stored-credential.ts';

export {
  buildAuthorizeUrl,
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
  CLAUDE_REVOKE_URL,
  CLAUDE_TOKEN_URL,
  createClaudeOAuth,
  createPkcePair,
  LOGIN_CANCELLED,
  LOGIN_TIMED_OUT,
  PASTE_INVALID_CODE,
  PASTE_PROMPT,
  PASTE_WRONG_SIGNIN,
  revokeAccessToken,
  revokeRefreshToken,
} from './oauth.ts';

const AMBIENT_TOKEN_VARIABLES: readonly string[] = ['ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN'];
const OAUTH_ACCESS_TOKEN = /^sk-ant-oat01-[A-Za-z0-9_-]+$/;

function tokenAuth({ value, source, env }: { value: string; source: string; env?: ProviderEnv | undefined }): AuthResult | undefined {
  if (!value) return undefined;
  const token = value.trim();
  if (!OAUTH_ACCESS_TOKEN.test(token)) throw new Error(`${source} must contain a Claude OAuth access token, not an API key.`);
  return { auth: { apiKey: token }, ...(env === undefined ? {} : { env }), source };
}

function subscriptionToken(options: SubscriptionAuthOptions): ApiKeyAuth {
  return {
    name: 'Claude subscription token',
    resolve: async ({ ctx, credential, signal }) => {
      signal.throwIfAborted();
      if (credential?.key !== undefined) return tokenAuth({ value: credential.key, source: 'stored credential', env: credential.env });
      const ambient = await ambientToken(ctx, signal);
      // Pi consults ambient auth only when nothing is stored, so a log left by the last login has nothing to lead from.
      if (credential === undefined) {
        options.onNoStoredCredential?.();
        await clearUnstoredRotationLog(options);
      }
      return ambient === undefined ? undefined : tokenAuth(ambient);
    },
  };
}

async function ambientToken(ctx: AuthContext, signal: AbortSignal): Promise<{ value: string; source: string } | undefined> {
  for (const source of AMBIENT_TOKEN_VARIABLES) {
    const value = await ctx.env(source);
    signal.throwIfAborted();
    if (value) return { value, source };
  }
  return undefined;
}

// Pi reported nothing stored, but another window may have logged in since. Only a host store that holds no login clears the log.
async function clearUnstoredRotationLog(options: SubscriptionAuthOptions): Promise<void> {
  const rotation = options.rotation;
  const directory = rotation?.directory();
  if (directory === undefined || rotation?.stored === undefined || storedOAuth(rotation.stored()) !== undefined) return;
  await clearRotationLog(directory);
}

async function recordedCredential(credential: OAuthCredential, options: SubscriptionAuthOptions): Promise<OAuthCredential> {
  const latest = await latestRecorded(options.rotation?.directory(), credential);
  return isSuccessor(latest, credential) && latest.expires > Date.now() ? latest : credential;
}

function wrapLoginErrors(oauth: Pick<OAuthAuth, 'login'>): OAuthAuth['login'] {
  return async (interaction, options) => {
    interaction.signal.throwIfAborted();
    try {
      return await oauth.login(interaction, options);
    } catch (error) {
      interaction.signal.throwIfAborted();
      if (error instanceof Error && error.message === LOGIN_CANCELLED) throw error;
      if (error instanceof Error && error.message === LOGIN_TIMED_OUT) throw error;
      if (error instanceof Error && (error.message === PASTE_INVALID_CODE || error.message === PASTE_WRONG_SIGNIN)) throw error;
      if (error instanceof Error && /Claude Code credentials/.test(error.message)) throw error;
      if (error instanceof Error && isClaudeTokenEndpointError(error.message)) throw error;
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

function wrapRefreshErrors(oauth: Pick<OAuthAuth, 'refresh'>): OAuthAuth['refresh'] {
  return async (credential, signal) => {
    signal.throwIfAborted();
    try {
      return await oauth.refresh(credential, signal);
    } catch (error) {
      signal.throwIfAborted();
      if (error instanceof Error && isClaudeTokenEndpointError(error.message)) throw error;
      throw new Error('Claude subscription token refresh failed. Retry or use /login to sign in again.');
    }
  };
}

export type SubscriptionAuthOptions = {
  onCredential?: (credential: OAuthCredential, rotation?: CredentialRotation) => void;
  /** Called when Pi resolves auth with no stored credential, as after `/logout`. */
  onNoStoredCredential?: () => void;
  /** `stored` reads what the host has stored; the log sweep keeps the stored login's chain and logout clears the log. */
  rotation?: { directory(): string | undefined; stored?: () => StoredCredential; claimOptions?: Omit<RefreshClaimOptions, 'liveCredential'> };
};

function claimOptionsFor(rotation: NonNullable<SubscriptionAuthOptions['rotation']>): RefreshClaimOptions {
  const stored = rotation.stored;
  return stored === undefined ? { ...rotation.claimOptions } : { ...rotation.claimOptions, liveCredential: () => storedOAuth(stored()) };
}

export type ClaudeOAuthClient = Omit<OAuthAuth, 'name' | 'loginLabel'>;

export type SubscriptionAuth = Required<Pick<ProviderAuth, 'apiKey' | 'oauth'>>;

export function subscriptionAuth(oauth: ClaudeOAuthClient = createClaudeOAuth(), options: SubscriptionAuthOptions = {}): SubscriptionAuth {
  const refresh = wrapRefreshErrors(oauth);
  return {
    apiKey: subscriptionToken(options),
    oauth: {
      ...oauth,
      name: 'Claude subscription (Provider CLI)',
      loginLabel: 'Claude subscription (Provider CLI)',
      login: wrapLoginErrors(oauth),
      refresh: async (credential, signal) => {
        const rotation = options.rotation;
        const directory = rotation?.directory();
        const next = rotation === undefined || directory === undefined ? await refresh(credential, signal) : await rotateRefreshToken({ directory, credential, refresh, options: claimOptionsFor(rotation), signal });
        options.onCredential?.(next, { replaced: credential });
        return next;
      },
      toAuth: async (credential) => {
        const current = await recordedCredential(credential, options);
        options.onCredential?.(current, current === credential ? undefined : { replaced: credential });
        return oauth.toAuth(current);
      },
    },
  };
}

export type { ClaudeOAuthOptions } from './oauth.ts';
