import { createHash, randomBytes } from 'node:crypto';

import type { FetchFunction, ModelAuth, OAuthAuth, OAuthCredential, ProviderAuthInteraction } from '@earendil-works/pi-ai';
import { readProjectOverride, resolveProject } from './code-assist.ts';
import { PROJECT_HEADER } from './constants.ts';
import { LoopbackExpiredError, startLoopbackCallback } from './loopback.ts';

// gemini-cli's installed-app client. Google documents installed-app secrets as non-confidential.
const CLIENT_ID = '681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com';
const CLIENT_SECRET = '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';
const SCOPES = ['https://www.googleapis.com/auth/cloud-platform', 'https://www.googleapis.com/auth/userinfo.email', 'https://www.googleapis.com/auth/userinfo.profile'];
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
/** gemini-cli's headless flow: the page shows a code that the user pastes into Pi. */
const MANUAL_REDIRECT_URI = 'https://codeassist.google.com/authcode';

/** Written by login() only. refresh() spreads it, because Pi replaces the stored credential with refresh()'s result. */
export type GoogleCredential = OAuthCredential & { projectId: string };

export interface GoogleOAuthDeps {
  fetch?: FetchFunction;
  env?: NodeJS.ProcessEnv;
}

class TokenRequestError extends Error {
  readonly code: string;
  constructor(code: string, description: string | undefined) {
    super(`Google token request failed: ${code}${description ? `. ${description}` : ''}`);
    this.code = code;
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
    loginLabel: 'Sign in with Google AI Plus, Pro, or Ultra',
    login: (interaction) => login(interaction, fetchImpl, deps.env ?? process.env),
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

export function buildAuthUrl(input: { redirectUri: string; state: string; codeChallenge: string }): string {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
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
    body: new URLSearchParams({ ...body, client_id: CLIENT_ID, client_secret: CLIENT_SECRET }),
    signal,
  });
  const payload: unknown = await response.json().catch(() => undefined);
  const fields = typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : {};
  if (!response.ok) {
    const description = fields['error_description'];
    throw new TokenRequestError(typeof fields['error'] === 'string' ? fields['error'] : `HTTP ${response.status}`, typeof description === 'string' ? description : undefined);
  }
  const { access_token, expires_in, refresh_token } = fields;
  if (typeof access_token !== 'string' || typeof expires_in !== 'number') throw new Error('Google token response was incomplete');
  return { access_token, expires_in, ...(typeof refresh_token === 'string' && refresh_token ? { refresh_token } : {}) };
}

async function login(interaction: ProviderAuthInteraction, fetchImpl: FetchFunction, env: NodeJS.ProcessEnv): Promise<OAuthCredential> {
  const envProject = readProjectOverride(env);
  const verifier = randomBytes(32).toString('base64url');
  const codeChallenge = createHash('sha256').update(verifier).digest('base64url');
  const state = randomBytes(32).toString('hex');

  const loopback = await startLoopbackCallback({ state, signal: interaction.signal });
  const cancelPrompt = new AbortController();
  try {
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
    const pasted = interaction.prompt({ type: 'manual_code', message: 'Authorization code', signal: cancelPrompt.signal }).then((code) => ({ code: code.trim(), redirectUri: MANUAL_REDIRECT_URI }));
    // The loser of the race is aborted or closed and rejects; that must not surface as an unhandled rejection.
    pasted.catch(() => undefined);
    const callback = loopback.code.then(
      (code) => ({ code, redirectUri: loopback.redirectUri }),
      (error: unknown) => (error instanceof LoopbackExpiredError ? new Promise<never>(() => undefined) : Promise.reject(error)),
    );
    callback.catch(() => undefined);
    const won = await Promise.race([callback, pasted]);
    if (!won.code) throw new Error('No authorization code entered');

    const tokens = await postToken({ grant_type: 'authorization_code', code: won.code, code_verifier: verifier, redirect_uri: won.redirectUri }, fetchImpl, interaction.signal);
    if (!tokens.refresh_token) throw new Error('Google returned no refresh token; run /login again');

    const project = await resolveProject({ accessToken: tokens.access_token, envProject, signal: interaction.signal, fetchImpl });
    interaction.notify({ type: 'info', message: `Google AI plan: ${project.tierName || project.tierId}. Code Assist project: ${project.projectId}.` });
    const credential: GoogleCredential = { type: 'oauth', access: tokens.access_token, refresh: tokens.refresh_token, expires: Date.now() + tokens.expires_in * 1000, projectId: project.projectId };
    return credential;
  } finally {
    cancelPrompt.abort();
    loopback.close();
  }
}

async function refresh(credential: OAuthCredential, signal: AbortSignal, fetchImpl: FetchFunction): Promise<OAuthCredential> {
  const stored = parseStoredCredential(credential);
  try {
    const tokens = await postToken({ grant_type: 'refresh_token', refresh_token: stored.refresh }, fetchImpl, signal);
    // Google usually omits refresh_token on refresh, so the old one stays.
    return { ...stored, type: 'oauth', access: tokens.access_token, expires: Date.now() + tokens.expires_in * 1000, refresh: tokens.refresh_token ?? stored.refresh };
  } catch (error) {
    if (error instanceof TokenRequestError && error.code === 'invalid_grant') throw new Error('Google refused the refresh token; run /login again');
    throw error;
  }
}

async function toAuth(credential: OAuthCredential): Promise<ModelAuth> {
  const stored = parseStoredCredential(credential);
  return { apiKey: stored.access, headers: { [PROJECT_HEADER]: stored.projectId } };
}
