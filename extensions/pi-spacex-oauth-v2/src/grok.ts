import type { OAuthCredentials, OAuthLoginCallbacks, ThinkingLevelMap } from '@earendil-works/pi-ai';
import type { ProviderConfig } from '@earendil-works/pi-coding-agent';
import { z } from 'zod';
import { refreshCatalog } from './catalog.ts';
import type { ChatModelConfig } from './stored-models.ts';

// Grok Build's own OIDC client and scopes, read from a Grok Build 1.0.77 login.
const ISSUER = 'https://auth.x.ai';
const CLIENT_ID = 'b1a00492-073a-47ea-816f-4c329264a828';
const DEVICE_CODE_PATH = '/oauth2/device/code';
const TOKEN_PATH = '/oauth2/token';
const SCOPE = 'openid profile email offline_access grok-cli:access api:access';
export const GROK_PROVIDER_ID = 'spacex-grok';
export const GROK_BASE_URL = 'https://cli-chat-proxy.grok.com/v1';
// The proxy answers 426 without a supported Grok Build version.
export const GROK_HEADERS = { 'x-grok-client-version': '1.0.77', 'User-Agent': 'grok-cli/1.0.77' };

const THINKING_LEVELS = ['low', 'medium', 'high', 'xhigh'] as const;

const MS_PER_SECOND = 1000;
const DEFAULT_TOKEN_TTL_SECONDS = 3600;
const DEFAULT_POLL_INTERVAL_SECONDS = 5;
const SLOW_DOWN_STEP_MS = 5000;
const DEFAULT_CONTEXT_WINDOW = 256_000;
const MAX_OUTPUT_TOKENS = 64_000;

const TokenResponseSchema = z.object({
  access_token: z.string().nullish(),
  refresh_token: z.string().nullish(),
  expires_in: z.coerce.number().nullish(),
  error: z.string().nullish(),
  error_description: z.string().nullish(),
});
type TokenResponse = z.infer<typeof TokenResponseSchema>;

const DeviceResponseSchema = z.object({
  device_code: z.string(),
  user_code: z.string(),
  verification_uri: z.string(),
  verification_uri_complete: z.string().nullish(),
  expires_in: z.coerce.number(),
  interval: z.coerce.number().nullish(),
});

const GrokModelSchema = z.object({
  id: z.string(),
  name: z.string().nullish().catch(undefined),
  context_window: z.number().nullish().catch(undefined),
  api_backend: z.string().nullish().catch(undefined),
  reasoning_efforts: z
    .array(z.object({ value: z.string() }))
    .nullish()
    .catch(undefined),
});

interface GrokModel {
  id: string;
  name?: string | null | undefined;
  context_window?: number | null | undefined;
  api_backend?: string | null | undefined;
  reasoning_efforts?: { value: string }[] | null | undefined;
}

const ModelListSchema = z.object({ data: z.array(GrokModelSchema) });

async function postForm(path: string, body: Record<string, string>, signal?: AbortSignal): Promise<TokenResponse> {
  const res = await fetch(`${ISSUER}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
    ...(signal ? { signal } : {}),
  });
  return TokenResponseSchema.parse(await res.json());
}

function toCredentials(token: TokenResponse, previousRefresh?: string): OAuthCredentials {
  const refresh = token.refresh_token ?? previousRefresh;
  if (!token.access_token || !refresh) throw new Error(`Grok sign-in failed: ${token.error_description ?? token.error ?? 'no token returned'}`);
  return { access: token.access_token, refresh, expires: Date.now() + (token.expires_in ?? DEFAULT_TOKEN_TTL_SECONDS) * MS_PER_SECOND };
}

const abortError = (signal: AbortSignal): Error => (signal.reason instanceof Error ? signal.reason : new Error('Grok sign-in aborted', { cause: signal.reason }));

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(abortError(signal));
      },
      { once: true },
    );
  });

export async function grokLogin(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
  const res = await fetch(`${ISSUER}${DEVICE_CODE_PATH}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT_ID, scope: SCOPE }),
  });
  if (!res.ok) throw new Error(`Grok device sign-in failed: HTTP ${res.status}`);
  const device = DeviceResponseSchema.parse(await res.json());
  let interval = (device.interval ?? DEFAULT_POLL_INTERVAL_SECONDS) * MS_PER_SECOND;
  callbacks.onDeviceCode({
    userCode: device.user_code,
    verificationUri: device.verification_uri_complete ?? device.verification_uri,
    openBrowserOnConfirm: true,
    intervalSeconds: interval / MS_PER_SECOND,
    expiresInSeconds: device.expires_in,
  });
  const deadline = Date.now() + device.expires_in * MS_PER_SECOND;
  while (Date.now() < deadline) {
    await sleep(interval, callbacks.signal);
    const token = await postForm(TOKEN_PATH, { grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: device.device_code, client_id: CLIENT_ID }, callbacks.signal);
    if (token.error === 'authorization_pending') continue;
    if (token.error === 'slow_down') {
      interval += SLOW_DOWN_STEP_MS;
      continue;
    }
    return toCredentials(token);
  }
  throw new Error('Grok device sign-in expired before it was approved');
}

export async function grokRefresh(credentials: OAuthCredentials, signal: AbortSignal): Promise<OAuthCredentials> {
  const token = await postForm(TOKEN_PATH, { grant_type: 'refresh_token', refresh_token: credentials.refresh, client_id: CLIENT_ID }, signal);
  return toCredentials(token, credentials.refresh);
}

const levelOrNull = (efforts: Set<string>, level: string): string | null => (efforts.has(level) ? level : null);

const toThinkingLevelMap = (efforts: Set<string>): ThinkingLevelMap => ({
  off: null,
  minimal: null,
  low: levelOrNull(efforts, 'low'),
  medium: levelOrNull(efforts, 'medium'),
  high: levelOrNull(efforts, 'high'),
  xhigh: levelOrNull(efforts, 'xhigh'),
  max: null,
});

export function toGrokModel(m: GrokModel): ChatModelConfig {
  const efforts = new Set((m.reasoning_efforts ?? []).map((e) => e.value));
  const supported = THINKING_LEVELS.filter((l) => efforts.has(l));
  return {
    id: m.id,
    name: m.name ?? m.id,
    reasoning: supported.length > 0,
    ...(supported.length > 0 ? { thinkingLevelMap: toThinkingLevelMap(efforts) } : {}),
    input: ['text', 'image'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: m.context_window ?? DEFAULT_CONTEXT_WINDOW,
    maxTokens: MAX_OUTPUT_TOKENS,
  };
}

export async function fetchGrokModels(accessToken: string, signal?: AbortSignal): Promise<ChatModelConfig[]> {
  const res = await fetch(`${GROK_BASE_URL}/models`, { headers: { Authorization: `Bearer ${accessToken}`, ...GROK_HEADERS }, ...(signal ? { signal } : {}) });
  if (!res.ok) throw new Error(`Grok Build model list failed: HTTP ${res.status}`);
  const body = ModelListSchema.parse(await res.json());
  return body.data.filter((m) => (m.api_backend ?? 'responses') === 'responses').map(toGrokModel);
}

// Seed list from Grok Build 1.0.77's /v1/models, used until the first live refresh.
const FALLBACK_MODELS: GrokModel[] = [
  { id: 'grok-4.7', name: 'Grok 4.7', context_window: DEFAULT_CONTEXT_WINDOW, reasoning_efforts: THINKING_LEVELS.map((value) => ({ value })) },
  { id: 'grok-4.7-build-fast', name: 'Grok 4.7 Build Fast', context_window: DEFAULT_CONTEXT_WINDOW, reasoning_efforts: THINKING_LEVELS.map((value) => ({ value })) },
  { id: 'grok-4.6', name: 'Grok 4.6', context_window: DEFAULT_CONTEXT_WINDOW, reasoning_efforts: THINKING_LEVELS.map((value) => ({ value })) },
  { id: 'grok-4.5', name: 'Grok 4.5', context_window: DEFAULT_CONTEXT_WINDOW, reasoning_efforts: ['low', 'medium', 'high'].map((value) => ({ value })) },
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
