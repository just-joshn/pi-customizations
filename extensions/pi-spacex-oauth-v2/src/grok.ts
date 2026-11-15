import type { OAuthCredentials, OAuthLoginCallbacks } from '@earendil-works/pi-ai';
import type { ProviderConfig, ProviderModelConfig } from '@earendil-works/pi-coding-agent';
import { refreshCatalog } from './catalog.ts';

// Grok Build's own OIDC client and scopes, read from a Grok Build 1.0.77 login.
const ISSUER = 'https://auth.x.ai';
const CLIENT_ID = 'b1a00492-073a-47ea-816f-4c329264a828';
const SCOPE = 'openid profile email offline_access grok-cli:access api:access';
export const GROK_PROVIDER_ID = 'spacex-grok';
export const GROK_BASE_URL = 'https://cli-chat-proxy.grok.com/v1';
// The proxy answers 426 without a supported Grok Build version.
export const GROK_HEADERS = { 'x-grok-client-version': '1.0.77', 'User-Agent': 'grok-cli/1.0.77' };

const THINKING_LEVELS = ['low', 'medium', 'high', 'xhigh'] as const;

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

interface GrokModel {
  id: string;
  name?: string;
  context_window?: number;
  api_backend?: string;
  reasoning_efforts?: { value: string }[];
}

async function postForm(path: string, body: Record<string, string>, signal?: AbortSignal): Promise<TokenResponse> {
  const res = await fetch(`${ISSUER}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
    ...(signal ? { signal } : {}),
  });
  return (await res.json()) as TokenResponse;
}

function toCredentials(token: TokenResponse, previousRefresh?: string): OAuthCredentials {
  const refresh = token.refresh_token ?? previousRefresh;
  if (!token.access_token || !refresh) throw new Error(`Grok sign-in failed: ${token.error_description ?? token.error ?? 'no token returned'}`);
  return { access: token.access_token, refresh, expires: Date.now() + (token.expires_in ?? 3600) * 1000 };
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });

export async function grokLogin(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
  const res = await fetch(`${ISSUER}/oauth2/device/code`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT_ID, scope: SCOPE }),
  });
  if (!res.ok) throw new Error(`Grok device sign-in failed: HTTP ${res.status}`);
  const device = (await res.json()) as { device_code: string; user_code: string; verification_uri: string; verification_uri_complete?: string; expires_in: number; interval?: number };
  let interval = (device.interval ?? 5) * 1000;
  callbacks.onDeviceCode({
    userCode: device.user_code,
    verificationUri: device.verification_uri_complete ?? device.verification_uri,
    openBrowserOnConfirm: true,
    intervalSeconds: interval / 1000,
    expiresInSeconds: device.expires_in,
  });
  const deadline = Date.now() + device.expires_in * 1000;
  while (Date.now() < deadline) {
    await sleep(interval, callbacks.signal);
    const token = await postForm('/oauth2/token', { grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: device.device_code, client_id: CLIENT_ID }, callbacks.signal);
    if (token.error === 'authorization_pending') continue;
    if (token.error === 'slow_down') {
      interval += 5000;
      continue;
    }
    return toCredentials(token);
  }
  throw new Error('Grok device sign-in expired before it was approved');
}

export async function grokRefresh(credentials: OAuthCredentials, signal: AbortSignal): Promise<OAuthCredentials> {
  const token = await postForm('/oauth2/token', { grant_type: 'refresh_token', refresh_token: credentials.refresh, client_id: CLIENT_ID }, signal);
  return toCredentials(token, credentials.refresh);
}

export function toGrokModel(m: GrokModel): ProviderModelConfig {
  const efforts = new Set((m.reasoning_efforts ?? []).map((e) => e.value));
  const supported = THINKING_LEVELS.filter((l) => efforts.has(l));
  return {
    id: m.id,
    name: m.name ?? m.id,
    reasoning: supported.length > 0,
    ...(supported.length > 0
      ? {
          thinkingLevelMap: {
            off: null,
            minimal: null,
            low: efforts.has('low') ? 'low' : null,
            medium: efforts.has('medium') ? 'medium' : null,
            high: efforts.has('high') ? 'high' : null,
            xhigh: efforts.has('xhigh') ? 'xhigh' : null,
            max: null,
          },
        }
      : {}),
    input: ['text', 'image'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: m.context_window ?? 256000,
    maxTokens: 64000,
  };
}

export async function fetchGrokModels(accessToken: string, signal?: AbortSignal): Promise<ProviderModelConfig[]> {
  const res = await fetch(`${GROK_BASE_URL}/models`, { headers: { Authorization: `Bearer ${accessToken}`, ...GROK_HEADERS }, ...(signal ? { signal } : {}) });
  if (!res.ok) throw new Error(`Grok Build model list failed: HTTP ${res.status}`);
  const body = (await res.json()) as { data: GrokModel[] };
  return body.data.filter((m) => (m.api_backend ?? 'responses') === 'responses').map(toGrokModel);
}

// Seed list from Grok Build 1.0.77's /v1/models, used until the first live refresh.
const FALLBACK_MODELS: GrokModel[] = [
  { id: 'grok-4.7', name: 'Grok 4.7', context_window: 256000, reasoning_efforts: THINKING_LEVELS.map((value) => ({ value })) },
  { id: 'grok-4.7-build-fast', name: 'Grok 4.7 Build Fast', context_window: 256000, reasoning_efforts: THINKING_LEVELS.map((value) => ({ value })) },
  { id: 'grok-4.6', name: 'Grok 4.6', context_window: 256000, reasoning_efforts: THINKING_LEVELS.map((value) => ({ value })) },
  { id: 'grok-4.5', name: 'Grok 4.5', context_window: 256000, reasoning_efforts: ['low', 'medium', 'high'].map((value) => ({ value })) },
];

export const grokProvider: ProviderConfig = {
  name: 'Grok Build (X subscription)',
  baseUrl: GROK_BASE_URL,
  api: 'openai-responses',
  headers: GROK_HEADERS,
  models: FALLBACK_MODELS.map(toGrokModel),
  refreshModels: (ctx) => refreshCatalog(ctx, { provider: GROK_PROVIDER_ID, api: 'openai-responses', baseUrl: GROK_BASE_URL }, FALLBACK_MODELS.map(toGrokModel), fetchGrokModels),
  oauth: {
    name: 'Grok Build (X subscription)',
    isSubscription: true,
    login: grokLogin,
    refreshToken: grokRefresh,
    getApiKey: (credentials) => credentials.access,
  },
};
