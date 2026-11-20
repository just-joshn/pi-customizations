import { createHash, randomBytes } from 'node:crypto';

import type { FetchFunction, ModelAuth, OAuthAuth, OAuthCredential, ProviderAuthInteraction } from '@earendil-works/pi-ai';
import { z } from 'zod';
import { readProjectOverride, resolveProject } from './code-assist.ts';
import { PRIVATE_PROJECT_HEADER } from './constants.ts';
import { type LoopbackCallback, LoopbackExpiredError, startLoopbackCallback } from './loopback.ts';

const ANTIGRAVITY_CLIENT_ID = '1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com';
// biome-ignore lint/security/noSecrets: Antigravity's public desktop OAuth client requires this shared application secret, not a user credential.
const ANTIGRAVITY_CLIENT_SECRET = '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';
const SCOPE_CLOUD_PLATFORM = 'https://www.googleapis.com/auth/cloud-platform';
const SCOPE_USER_EMAIL = 'https://www.googleapis.com/auth/userinfo.email';
const SCOPE_USER_PROFILE = 'https://www.googleapis.com/auth/userinfo.profile';
const SCOPE_CCLOG = 'https://www.googleapis.com/auth/cclog';
const SCOPE_EXPERIMENTS = 'https://www.googleapis.com/auth/experimentsandconfigs';
const SCOPE_AICODE = 'https://www.googleapis.com/auth/aicode';
const SCOPES = [SCOPE_CLOUD_PLATFORM, SCOPE_USER_EMAIL, SCOPE_USER_PROFILE, SCOPE_CCLOG, SCOPE_EXPERIMENTS, SCOPE_AICODE, 'openid'];
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const MANUAL_REDIRECT_URI = 'https://antigravity.google/oauth-callback';
const RANDOM_BYTES = 32;
const TOKEN_FIELDS = z.record(z.string(), z.unknown());
const MS_PER_SECOND = 1000;
const ENV_SCHEMA = z.record(z.string(), z.string().optional());

export type GoogleCredential = OAuthCredential & { projectId: string };

export interface GoogleOAuthDeps {
  fetch?: FetchFunction;
  env?: NodeJS.ProcessEnv;
}

class TokenRequestError extends Error {
  constructor(code: string, description: string | undefined) {
    super(`Google token request failed: ${code}${description ? `. ${description}` : ''}`, { cause: code });
  }

  get code(): string {
    return String(this.cause);
  }
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
}

export function createGoogleOAuth(deps: GoogleOAuthDeps = {}): OAuthAuth {
  const fetchImpl: FetchFunction = (input, init) => (deps.fetch ?? globalThis.fetch)(input, init);
  return {
    name: 'Google AI subscription',
    isSubscription: true,
    loginLabel: 'Sign in with your Google AI plan',
    login: (interaction) => login(interaction, fetchImpl, deps.env ?? ENV_SCHEMA.parse({ ...process.env })),
    refresh: (credential, signal) => refresh(credential, signal, fetchImpl),
    toAuth,
  };
}

export function parseStoredCredential(credential: OAuthCredential): GoogleCredential {
  const { access, refresh, expires, projectId } = credential;
  if (typeof access !== 'string' || typeof refresh !== 'string' || typeof expires !== 'number' || !Number.isFinite(expires) || typeof projectId !== 'string' || !projectId) {
    throw new Error('Google AI login is incomplete; run /login again');
  }
  return { ...credential, projectId };
}

function buildAuthUrl(input: { redirectUri: string; state: string; codeChallenge: string }): string {
  const params = new URLSearchParams({
    client_id: ANTIGRAVITY_CLIENT_ID,
    redirect_uri: input.redirectUri,
    response_type: 'code',
    scope: SCOPES.join(' '),
    access_type: 'offline',
    // Without prompt=consent Google omits refresh_token when the account already consented.
    prompt: 'consent',
    state: input.state,
    code_challenge: input.codeChallenge,
    code_challenge_method: 'S256',
  });
  return `${AUTH_URL}?${params}`;
}

async function postToken(body: Record<string, string>, fetchImpl: FetchFunction, signal: AbortSignal): Promise<TokenResponse> {
  const response = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ...body, client_id: ANTIGRAVITY_CLIENT_ID, client_secret: ANTIGRAVITY_CLIENT_SECRET }),
    signal,
  });
  const payload: unknown = await response.json().catch(() => undefined);
  const fields = TOKEN_FIELDS.safeParse(payload).data ?? {};
  if (!response.ok) {
    const description = fields['error_description'];
    throw new TokenRequestError(typeof fields['error'] === 'string' ? fields['error'] : `HTTP ${response.status}`, typeof description === 'string' ? description : undefined);
  }
  const { access_token, expires_in, refresh_token } = fields;
  if (typeof access_token !== 'string' || typeof expires_in !== 'number') throw new Error('Google token response was incomplete');
  return { access_token, expires_in, ...(typeof refresh_token === 'string' && refresh_token ? { refresh_token } : {}) };
}

interface AuthorizationResult {
  code: string;
  redirectUri: string;
}

/** Once the loopback window expires, only the pasted code can finish the login, so this side never settles. */
function unsettled(): Promise<never> {
  return new Promise<never>(() => {
    // Intentionally never resolves or rejects.
  });
}

async function awaitAuthorizationCode(interaction: ProviderAuthInteraction, loopback: LoopbackCallback, pkce: { state: string; codeChallenge: string }, cancelPrompt: AbortSignal): Promise<AuthorizationResult> {
  const { state, codeChallenge } = pkce;
  interaction.notify({
    type: 'auth_url',
    url: buildAuthUrl({ redirectUri: loopback.redirectUri, state, codeChallenge }),
    instructions: 'Sign in with the Google account that has your AI plan.',
  });
  interaction.notify({
    type: 'info',
    message: 'No browser on this machine? Open the code page, then paste the code it shows.',
    links: [{ url: buildAuthUrl({ redirectUri: MANUAL_REDIRECT_URI, state, codeChallenge }), label: 'Code page' }],
  });
  const pasted = interaction.prompt({ type: 'manual_code', message: 'Authorization code', signal: cancelPrompt }).then((code): AuthorizationResult => ({ code: code.trim(), redirectUri: MANUAL_REDIRECT_URI }));
  pasted.catch(() => undefined);
  const callback = loopback.code.then(
    (code): AuthorizationResult => ({ code, redirectUri: loopback.redirectUri }),
    (error: unknown): Promise<never> => {
      if (error instanceof LoopbackExpiredError) return unsettled();
      throw error instanceof Error ? error : new Error(String(error));
    },
  );
  callback.catch(() => undefined);
  const won = await Promise.race([callback, pasted]);
  if (!won.code) throw new Error('No authorization code entered');
  return won;
}

async function login(interaction: ProviderAuthInteraction, fetchImpl: FetchFunction, env: NodeJS.ProcessEnv): Promise<OAuthCredential> {
  const envProject = readProjectOverride(env);
  const verifier = randomBytes(RANDOM_BYTES).toString('base64url');
  const codeChallenge = createHash('sha256').update(verifier).digest('base64url');
  const state = randomBytes(RANDOM_BYTES).toString('hex');

  const loopback = await startLoopbackCallback({ state, signal: interaction.signal });
  const cancelPrompt = new AbortController();
  try {
    const won = await awaitAuthorizationCode(interaction, loopback, { state, codeChallenge }, cancelPrompt.signal);
    const tokens = await postToken({ grant_type: 'authorization_code', code: won.code, code_verifier: verifier, redirect_uri: won.redirectUri }, fetchImpl, interaction.signal);
    if (!tokens.refresh_token) throw new Error('Google returned no refresh token; run /login again');

    const project = await resolveProject({ accessToken: tokens.access_token, envProject, signal: interaction.signal, fetchImpl });
    interaction.notify({ type: 'info', message: `Google AI plan: ${project.tierName || project.tierId}. Code Assist project: ${project.projectId}.` });
    const credential: GoogleCredential = { type: 'oauth', access: tokens.access_token, refresh: tokens.refresh_token, expires: Date.now() + tokens.expires_in * MS_PER_SECOND, projectId: project.projectId };
    return credential;
  } finally {
    cancelPrompt.abort();
    loopback.close();
  }
}

function rejectRefresh(error: unknown): never {
  if (error instanceof TokenRequestError && error.code === 'invalid_grant') throw new Error('Google refused the refresh token; run /login again');
  throw error;
}

async function refresh(credential: OAuthCredential, signal: AbortSignal, fetchImpl: FetchFunction): Promise<OAuthCredential> {
  const stored = parseStoredCredential(credential);
  const tokens = await postToken({ grant_type: 'refresh_token', refresh_token: stored.refresh }, fetchImpl, signal).catch(rejectRefresh);
  // Google usually omits refresh_token on refresh, so the old one stays.
  return { ...stored, type: 'oauth', access: tokens.access_token, expires: Date.now() + tokens.expires_in * MS_PER_SECOND, refresh: tokens.refresh_token ?? stored.refresh };
}

async function toAuth(credential: OAuthCredential): Promise<ModelAuth> {
  const stored = parseStoredCredential(credential);
  return { apiKey: stored.access, headers: { [PRIVATE_PROJECT_HEADER]: stored.projectId } };
}
