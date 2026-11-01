import { createHash, randomBytes } from 'node:crypto';

import type { OAuthAuth, OAuthCredential, ProviderAuthInteraction } from '@earendil-works/pi-ai';
import { CLOUD_CODE_URL, encodeApiKey, errorText, postCloudCode } from './cloudcode.ts';
import { readAgyKeychainPassword, tokensFromGoKeyringPassword, type ImportedAgyTokens } from './keychain.ts';

export type AntigravityCredential = OAuthCredential & { projectId: string; email?: string | undefined };

export const LOGIN_BROWSER = 'browser';
export const LOGIN_KEYCHAIN = 'keychain';

export interface AntigravityOAuthOptions {
  offerKeychainImport?: boolean;
  readKeychainPassword?: () => Promise<string>;
}

export interface OAuthEndpoints {
  authUrl: string;
  tokenUrl: string;
  userInfoUrl: string;
  tokenInfoUrl: string;
  cloudCode: string;
}

// The Antigravity CLI uses Go's google.Endpoint and reads the email from the v2 userinfo API.
export const GOOGLE_OAUTH: OAuthEndpoints = {
  authUrl: 'https://accounts.google.com/o/oauth2/auth',
  tokenUrl: 'https://oauth2.googleapis.com/token',
  userInfoUrl: 'https://www.googleapis.com/oauth2/v2/userinfo',
  tokenInfoUrl: 'https://www.googleapis.com/oauth2/v3/tokeninfo',
  cloudCode: CLOUD_CODE_URL,
};

// The Antigravity CLI's installed-app client. Google treats an installed-app client secret as
// non-confidential, so this is a public credential, not a leak.
const CLIENT_SECRET = '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';
const CLIENT_ID = '1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com';

// The CLI sends Google to this page, which shows the code for the user to paste back.
export const REDIRECT_URI = 'https://antigravity.google/oauth-callback';

export const SCOPES = [
  'https://www.googleapis.com/auth/cloud-platform',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/cclog',
  'https://www.googleapis.com/auth/experimentsandconfigs',
  'https://www.googleapis.com/auth/aicode',
  'openid',
];

// golang.org/x/oauth2 treats a token as expired this long before Google's expiry.
const EXPIRY_DELTA_MS = 10_000;

export function parseCredential(credential: OAuthCredential): AntigravityCredential {
  const { projectId, email } = credential;
  if (typeof projectId !== 'string' || !projectId || !credential.access) {
    throw new Error('Google Antigravity credentials lack a project. Run /login and choose Google Antigravity.');
  }
  return { ...credential, projectId, email: typeof email === 'string' ? email : undefined };
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

async function requestToken(url: string, params: Record<string, string>, signal: AbortSignal): Promise<TokenResponse> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ...params, client_id: CLIENT_ID, client_secret: CLIENT_SECRET }),
    signal,
  });
  const text = await response.text();
  // A proxy or captive portal can answer with a page instead of JSON, and the request on the wire
  // carries the client secret, the PKCE verifier, and the refresh token, so never echo it whole.
  if (!response.ok) throw new Error(`Google token request failed (${response.status}): ${errorText(text).slice(0, 200)}`);
  const data = JSON.parse(text) as Partial<TokenResponse>;
  if (typeof data.access_token !== 'string' || typeof data.expires_in !== 'number') {
    throw new Error('Google token response lacks an access token');
  }
  return data as TokenResponse;
}

function expiresAt(token: TokenResponse): number {
  return Date.now() + token.expires_in * 1000 - EXPIRY_DELTA_MS;
}

export async function fetchEmail(userInfoUrl: string, token: string, signal?: AbortSignal): Promise<string | undefined> {
  try {
    const response = await fetch(userInfoUrl, { headers: { Authorization: `Bearer ${token}` }, ...(signal !== undefined && { signal }) });
    if (!response.ok) return undefined;
    const { email } = (await response.json()) as { email?: unknown };
    return typeof email === 'string' ? email : undefined;
  } catch {
    return undefined;
  }
}

export async function validateAccessToken(tokenInfoUrl: string, access: string, signal?: AbortSignal): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`${tokenInfoUrl}?access_token=${encodeURIComponent(access)}`, {
      ...(signal !== undefined && { signal }),
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`failed to call tokeninfo: ${detail}`);
  }
  if (!response.ok) throw new Error(`tokeninfo returned status ${response.status}`);
}

function isOpaqueInvalidTokenError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /invalid_token|invalid_grant/i.test(message);
}

export const LOAD_CODE_ASSIST_BODY = { metadata: { ideType: 'ANTIGRAVITY' } };

// Measured from agy CLOUD_CODE_URL sink capture (parity/oauth-rea-2026-10-31/agy/fixtures/captured-user-agent.json).
export const ONBOARD_USER_BODY = { tierId: 'free-tier', metadata: { ideType: 'ANTIGRAVITY' } };

export function projectFromLoadCodeAssist(data: unknown): string | undefined {
  const project = (data as { cloudaicompanionProject?: unknown } | null)?.cloudaicompanionProject;
  if (typeof project === 'string' && project) return project;
  const id = (project as { id?: unknown } | null)?.id;
  return typeof id === 'string' && id ? id : undefined;
}

export async function discoverProject(endpoint: string, token: string, signal: AbortSignal): Promise<string> {
  const load = () => postCloudCode(endpoint, 'loadCodeAssist', token, LOAD_CODE_ASSIST_BODY, signal);
  let project = projectFromLoadCodeAssist(await load());
  if (project) return project;
  await postCloudCode(endpoint, 'onboardUser', token, ONBOARD_USER_BODY, signal);
  project = projectFromLoadCodeAssist(await load());
  if (!project) throw new Error('Cloud Code named no Antigravity project for this account after onboarding.');
  return project;
}

export function credentialFromImportedTokens(tokens: ImportedAgyTokens, projectId: string): AntigravityCredential {
  return {
    type: 'oauth',
    access: tokens.access,
    refresh: tokens.refresh,
    expires: tokens.expires,
    projectId,
    ...(tokens.email && { email: tokens.email }),
  };
}

export async function importAgyKeychainCredential(
  endpoints: Pick<OAuthEndpoints, 'cloudCode' | 'tokenInfoUrl'>,
  password: string,
  signal: AbortSignal,
  now = Date.now(),
): Promise<AntigravityCredential> {
  const tokens = tokensFromGoKeyringPassword(password, now);
  try {
    const projectId = await discoverProject(endpoints.cloudCode, tokens.access, signal);
    return credentialFromImportedTokens(tokens, projectId);
  } catch (error) {
    if (signal.aborted || !isOpaqueInvalidTokenError(error)) throw error;
    await validateAccessToken(endpoints.tokenInfoUrl, tokens.access, signal);
    throw error;
  }
}

function authorizationUrl(authUrl: string, challenge: string, state: string): string {
  const params = new URLSearchParams({
    access_type: 'offline',
    client_id: CLIENT_ID,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    prompt: 'consent',
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: SCOPES.join(' '),
    state,
  });
  return `${authUrl}?${params.toString()}`;
}

async function authorize(endpoints: OAuthEndpoints, interaction: ProviderAuthInteraction): Promise<AntigravityCredential> {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const state = randomBytes(16).toString('base64url');
  interaction.notify({
    type: 'auth_url',
    url: authorizationUrl(endpoints.authUrl, challenge, state),
    instructions: 'Complete the sign-in in your browser, then copy the authorization code that Antigravity shows.',
  });
  const code = (await interaction.prompt({ type: 'manual_code', message: 'Paste the authorization code here:', signal: interaction.signal })).trim();
  if (!code) throw new Error('Missing authorization code');
  interaction.notify({ type: 'progress', message: 'Exchanging authorization code' });
  const token = await requestToken(endpoints.tokenUrl, { code, code_verifier: verifier, grant_type: 'authorization_code', redirect_uri: REDIRECT_URI }, interaction.signal);
  if (!token.refresh_token) throw new Error('Google returned no refresh token. Try /login again.');
  interaction.notify({ type: 'progress', message: 'Finding your Antigravity project' });
  const [email, projectId] = await Promise.all([fetchEmail(endpoints.userInfoUrl, token.access_token, interaction.signal), discoverProject(endpoints.cloudCode, token.access_token, interaction.signal)]);
  return {
    type: 'oauth',
    access: token.access_token,
    refresh: token.refresh_token,
    expires: expiresAt(token),
    projectId,
    ...(email && { email }),
  };
}

async function loginWithMethod(endpoints: OAuthEndpoints, interaction: ProviderAuthInteraction, options: AntigravityOAuthOptions): Promise<AntigravityCredential> {
  if (options.offerKeychainImport) {
    const method = await interaction.prompt({
      type: 'select',
      message: 'How do you want to sign in to Google Antigravity?',
      options: [
        { id: LOGIN_BROWSER, label: 'Sign in with Google in the browser', description: 'Paste the authorization code Antigravity shows' },
        {
          id: LOGIN_KEYCHAIN,
          label: 'Import from the Antigravity CLI keychain',
          description: 'Reuse the gemini/antigravity item already on this Mac',
        },
      ],
    });
    if (method === LOGIN_KEYCHAIN) {
      interaction.notify({ type: 'progress', message: 'Reading the Antigravity keychain credential' });
      const password = await (options.readKeychainPassword ?? readAgyKeychainPassword)();
      interaction.notify({ type: 'progress', message: 'Finding your Antigravity project' });
      return importAgyKeychainCredential(endpoints, password, interaction.signal);
    }
    if (method !== LOGIN_BROWSER) throw new Error(`Unknown Google Antigravity login method: ${method}`);
  }
  return authorize(endpoints, interaction);
}

export function createAntigravityOAuth(endpoints: OAuthEndpoints = GOOGLE_OAUTH, options: AntigravityOAuthOptions = {}): OAuthAuth {
  return {
    name: 'Google Antigravity',
    loginLabel: 'Sign in with Google (Antigravity)',
    isSubscription: true,
    login: (interaction) => loginWithMethod(endpoints, interaction, options),
    async refresh(credential, signal) {
      const current = parseCredential(credential);
      try {
        const token = await requestToken(endpoints.tokenUrl, { grant_type: 'refresh_token', refresh_token: current.refresh }, signal);
        return { ...current, access: token.access_token, refresh: token.refresh_token ?? current.refresh, expires: expiresAt(token) };
      } catch (error) {
        if (!isOpaqueInvalidTokenError(error)) throw error;
        await validateAccessToken(endpoints.tokenInfoUrl, current.access, signal);
        throw error;
      }
    },
    async toAuth(credential) {
      const { access, projectId } = parseCredential(credential);
      return { apiKey: encodeApiKey({ token: access, projectId }) };
    },
  };
}
