import { createHash, randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';

import type { OAuthAuth, OAuthCredential, ProviderAuthInteraction } from '@earendil-works/pi-ai';
import { CLOUD_CODE_ENDPOINTS, encodeApiKey, errorText, postCloudCode } from './cloudcode.ts';

export type AntigravityCredential = OAuthCredential & { projectId: string; email?: string | undefined };

export interface OAuthEndpoints {
  authUrl: string;
  tokenUrl: string;
  userInfoUrl: string;
  cloudCode: readonly string[];
  callbackHost: string;
  callbackPort: number;
}

export const GOOGLE_OAUTH: OAuthEndpoints = {
  authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenUrl: 'https://oauth2.googleapis.com/token',
  userInfoUrl: 'https://www.googleapis.com/oauth2/v1/userinfo?alt=json',
  cloudCode: CLOUD_CODE_ENDPOINTS,
  callbackHost: process.env['PI_OAUTH_CALLBACK_HOST'] || '127.0.0.1',
  callbackPort: 51121,
};

// The Antigravity desktop app's installed-app client, as shipped in Pi 0.70.6. Google treats an
// installed-app client secret as non-confidential, so this is a public credential, not a leak. It was
// previously stored as char-code arrays to keep secret scanners quiet, which hid the value from every
// reader and made a real leak indistinguishable from this one.
// biome-ignore lint/security/noSecrets: public installed-app credential, not a confidential secret
const CLIENT_SECRET = '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';
const CLIENT_ID = '1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com';

const SCOPES = [
  'https://www.googleapis.com/auth/cloud-platform',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/cclog',
  'https://www.googleapis.com/auth/experimentsandconfigs',
];

// Pi 0.70.6 used this shared project when loadCodeAssist named none.
const SHARED_FALLBACK_PROJECT_ID = 'rising-fact-p41fc';
const EXPIRY_MARGIN_MS = 5 * 60 * 1000;

export function parseCredential(credential: OAuthCredential): AntigravityCredential {
  const { projectId, email } = credential;
  if (typeof projectId !== 'string' || !projectId || !credential.access) {
    throw new Error('Google Antigravity credentials lack a project. Run /login and choose Google Antigravity.');
  }
  return { ...credential, projectId, email: typeof email === 'string' ? email : undefined };
}

function base64Url(bytes: Buffer): string {
  return bytes.toString('base64url');
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
    body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, ...params }),
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

export const LOAD_CODE_ASSIST_BODY = {
  metadata: { ideType: 'ANTIGRAVITY', platform: 'PLATFORM_UNSPECIFIED', pluginType: 'GEMINI' },
};

export function projectFromLoadCodeAssist(data: unknown): string | undefined {
  const project = (data as { cloudaicompanionProject?: unknown } | null)?.cloudaicompanionProject;
  if (typeof project === 'string' && project) return project;
  const id = (project as { id?: unknown } | null)?.id;
  return typeof id === 'string' && id ? id : undefined;
}

async function discoverProject(endpoints: readonly string[], token: string, signal: AbortSignal): Promise<string> {
  try {
    const data = await postCloudCode(endpoints, 'loadCodeAssist', token, LOAD_CODE_ASSIST_BODY, signal);
    return projectFromLoadCodeAssist(data) ?? SHARED_FALLBACK_PROJECT_ID;
  } catch (error) {
    if (signal.aborted) throw error;
    return SHARED_FALLBACK_PROJECT_ID;
  }
}

interface CallbackServer {
  code: Promise<{ code: string; state: string }>;
  close(): void;
}

function listenForCallback(host: string, port: number, signal: AbortSignal): Promise<CallbackServer> {
  let settle!: { resolve(value: { code: string; state: string }): void; reject(error: Error): void };
  const code = new Promise<{ code: string; state: string }>((resolve, reject) => {
    settle = { resolve, reject };
  });
  code.catch(() => {});
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://localhost:${port}`);
    if (url.pathname !== '/oauth-callback') {
      res.writeHead(404).end();
      return;
    }
    const error = url.searchParams.get('error');
    const received = { code: url.searchParams.get('code'), state: url.searchParams.get('state') };
    const ok = !error && received.code && received.state;
    res.writeHead(ok ? 200 : 400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(ok ? 'Google sign-in completed. You can close this window.' : 'Google sign-in did not complete.');
    const code = received.code;
    const state = received.state;
    if (ok && code && state) settle.resolve({ code, state });
    else settle.reject(new Error(`Google sign-in did not complete: ${error ?? 'missing code'}`));
  });
  signal.addEventListener('abort', () => settle.reject(new Error('Login was cancelled')), { once: true });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () =>
      resolve({
        code,
        close: () => {
          server.close();
          server.closeAllConnections();
        },
      }),
    );
  });
}

function codeFromRedirect(input: string, state: string): string {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error('Paste the full redirect URL from the browser address bar');
  }
  const code = url.searchParams.get('code');
  if (!code) throw new Error('The pasted URL has no authorization code');
  if (url.searchParams.get('state') !== state) throw new Error('OAuth state mismatch');
  return code;
}

async function awaitCode(callback: CallbackServer, interaction: ProviderAuthInteraction, state: string): Promise<string> {
  const manualDone = new AbortController();
  const manual = interaction
    .prompt({
      type: 'manual_code',
      message: 'Paste the redirect URL if the browser cannot reach this machine',
      signal: AbortSignal.any([manualDone.signal, interaction.signal]),
    })
    .then((input) => codeFromRedirect(input, state));
  manual.catch(() => {});
  const fromBrowser = callback.code.then((result) => {
    if (result.state !== state) throw new Error('OAuth state mismatch');
    return result.code;
  });
  try {
    return await Promise.race([fromBrowser, manual]);
  } finally {
    manualDone.abort();
  }
}

function authorizationParams(redirectUri: string, challenge: string, state: string): string {
  return new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: SCOPES.join(' '),
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
    access_type: 'offline',
    prompt: 'consent',
  }).toString();
}

async function findAccount(endpoints: OAuthEndpoints, token: string, signal: AbortSignal): Promise<{ email: string | undefined; projectId: string }> {
  const [email, projectId] = await Promise.all([fetchEmail(endpoints.userInfoUrl, token, signal), discoverProject(endpoints.cloudCode, token, signal)]);
  return { email, projectId };
}

async function authorize(endpoints: OAuthEndpoints, redirectUri: string, interaction: ProviderAuthInteraction): Promise<AntigravityCredential> {
  const verifier = base64Url(randomBytes(32));
  const challenge = base64Url(createHash('sha256').update(verifier).digest());
  const state = base64Url(randomBytes(16));
  const callback = await listenForCallback(endpoints.callbackHost, endpoints.callbackPort, interaction.signal);
  try {
    interaction.notify({
      type: 'auth_url',
      url: `${endpoints.authUrl}?${authorizationParams(redirectUri, challenge, state)}`,
      instructions: 'Complete the sign-in in your browser.',
    });
    const code = await awaitCode(callback, interaction, state);
    interaction.notify({ type: 'progress', message: 'Exchanging authorization code' });
    const token = await requestToken(endpoints.tokenUrl, { code, grant_type: 'authorization_code', redirect_uri: redirectUri, code_verifier: verifier }, interaction.signal);
    if (!token.refresh_token) throw new Error('Google returned no refresh token. Try /login again.');
    interaction.notify({ type: 'progress', message: 'Finding your Antigravity project' });
    const { email, projectId } = await findAccount(endpoints, token.access_token, interaction.signal);
    return {
      type: 'oauth',
      access: token.access_token,
      refresh: token.refresh_token,
      expires: Date.now() + token.expires_in * 1000 - EXPIRY_MARGIN_MS,
      projectId,
      ...(email && { email }),
    };
  } finally {
    callback.close();
  }
}

export function createAntigravityOAuth(endpoints: OAuthEndpoints = GOOGLE_OAUTH): OAuthAuth {
  const redirectUri = `http://localhost:${endpoints.callbackPort}/oauth-callback`;
  return {
    name: 'Google Antigravity',
    loginLabel: 'Sign in with Google (Antigravity)',
    isSubscription: true,
    login: (interaction) => authorize(endpoints, redirectUri, interaction),
    async refresh(credential, signal) {
      const current = parseCredential(credential);
      const token = await requestToken(endpoints.tokenUrl, { refresh_token: current.refresh, grant_type: 'refresh_token' }, signal);
      return {
        ...current,
        access: token.access_token,
        refresh: token.refresh_token ?? current.refresh,
        expires: Date.now() + token.expires_in * 1000 - EXPIRY_MARGIN_MS,
      };
    },
    async toAuth(credential) {
      const { access, projectId } = parseCredential(credential);
      return { apiKey: encodeApiKey({ token: access, projectId }) };
    },
  };
}
