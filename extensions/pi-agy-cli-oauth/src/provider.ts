import { hasApi, type ApiKeyAuth, type AuthContext, type Model, type OAuthAuth, type Provider, type ProviderEnv, type RefreshModelsContext } from '@earendil-works/pi-ai';
import { API_ID, PROVIDER_DISPLAY_NAME, PROVIDER_ENV_NAMES, PROVIDER_ID, PROBE_TTL_MS, PROCESS_BASE_URL } from './constants.ts';
import { probe, type ProbeResult } from './discovery.ts';
import { launchSpec } from './launch.ts';
import { BASELINE_MODELS, catalogToModels } from './model-catalog.ts';
import { streamAgy } from './stream.ts';

type AgyModel = Model<typeof API_ID>;

/**
 * Pi resolves provider-scoped settings such as `PI_AGY_COMMAND` only through auth
 * hooks. Remember the latest values so discovery and the status command look at
 * the same installation the requests use.
 */
let lastProviderEnv: ProviderEnv | undefined;
let lastProbe: { key: string; at: number; result: ProbeResult } | undefined;
let discovered: readonly AgyModel[] | undefined;

async function providerEnvironment(ctx: AuthContext): Promise<ProviderEnv | undefined> {
  const pairs = await Promise.all(PROVIDER_ENV_NAMES.map(async (name): Promise<[string, string | undefined]> => [name, await ctx.env(name)]));
  const env: ProviderEnv = Object.fromEntries(pairs.filter((pair): pair is [string, string] => pair[1] !== undefined));
  return Object.keys(env).length > 0 ? env : undefined;
}

/** The environment this provider most recently resolved, for callers outside a request. */
export function cliEnvironment(): ProviderEnv | undefined {
  return lastProviderEnv;
}

function probeKey(env: ProviderEnv | undefined): string {
  return JSON.stringify(env ?? {});
}

/** Probe an installation, reusing a recent answer for an unchanged environment. */
export async function probeInstallation(env: ProviderEnv | undefined, options: { signal?: AbortSignal; force?: boolean } = {}): Promise<ProbeResult> {
  const key = probeKey(env);
  const cached = lastProbe;
  const fresh = cached !== undefined && cached.key === key && Date.now() - cached.at < PROBE_TTL_MS;
  if (fresh && options.force !== true) return cached.result;
  return rememberProbe(key, await probe(launchSpec(env), options));
}

/** Record a probe result. Kept separate so the cache write has no await in front of it. */
function rememberProbe(key: string, result: ProbeResult): ProbeResult {
  lastProbe = { key, at: Date.now(), result };
  return result;
}

function configuredAuth(result: ProbeResult) {
  if (!result.available) return undefined;
  const tier = result.discovery?.tierName;
  // An account with a plan is a subscription, which Pi must label as such.
  return { type: 'oauth' as const, source: tier === undefined ? 'Antigravity CLI' : `Antigravity ${tier}` };
}

async function rememberEnvironment(ctx: AuthContext): Promise<ProviderEnv | undefined> {
  const env = await providerEnvironment(ctx);
  lastProviderEnv = env;
  return env;
}

function apiKeyAuth(): ApiKeyAuth {
  return {
    name: 'Antigravity CLI login',
    async check({ ctx, signal }) {
      const env = await rememberEnvironment(ctx);
      const result = await probeInstallation(env, { signal });
      // Only report the provider as configured when the CLI is installed and
      // signed in, so Pi hides its models otherwise.
      return result.available ? configuredAuth(result) : undefined;
    },
    async resolve({ ctx, signal }) {
      signal.throwIfAborted();
      const env = await rememberEnvironment(ctx);
      const auth = { apiKey: 'external-process' };
      return env === undefined ? { auth, source: 'Antigravity CLI' } : { auth, env, source: 'Antigravity CLI' };
    },
  };
}

/**
 * Metadata marker for Pi's subscription-aware UI. This is deliberately not the
 * request auth path and never imports CLI credentials. Sign-in and sign-out are
 * handled by the CLI itself.
 */
function oauthMarker(): OAuthAuth {
  return {
    name: 'Antigravity CLI account (managed by the CLI)',
    isSubscription: true,
    async login() {
      throw new Error('The Antigravity CLI manages its own login. Sign in with `agy` in a terminal instead; this provider uses that account automatically.');
    },
    async refresh() {
      const result = await probeInstallation(lastProviderEnv, { force: true });
      if (!result.available) throw new Error(result.detail ?? 'The Antigravity CLI is not signed in');
      return { type: 'oauth', access: 'agy-cli-external', refresh: 'agy-cli-external', expires: Date.now() + PROBE_TTL_MS };
    },
    async toAuth() {
      return { apiKey: 'external-process' };
    },
  };
}

async function restoreStored(context: RefreshModelsContext): Promise<boolean> {
  const stored = context.stored?.models.filter((model): model is AgyModel => model.provider === PROVIDER_ID && hasApi(model, API_ID));
  if (stored === undefined || stored.length === 0) return true;
  const adopt = (): void => {
    discovered = stored;
  };
  return context.publish({ update: adopt });
}

async function refresh(context: RefreshModelsContext): Promise<void> {
  if (!(await restoreStored(context))) return;
  if (!context.allowNetwork || context.signal.aborted) return;
  const result = await probeInstallation(lastProviderEnv, { signal: context.signal, force: context.force === true });
  if (!result.available || result.discovery === undefined || context.signal.aborted) return;
  const models = catalogToModels(result.discovery);
  const adopt = (): void => {
    discovered = models;
  };
  await context.publish({ persist: { models, checkedAt: Date.now() }, update: adopt });
}

export function createAgyProvider(): Provider<typeof API_ID> {
  return {
    id: PROVIDER_ID,
    name: PROVIDER_DISPLAY_NAME,
    baseUrl: PROCESS_BASE_URL,
    auth: { apiKey: apiKeyAuth(), oauth: oauthMarker() },
    getModels: () => discovered ?? BASELINE_MODELS,
    refreshModels: refresh,
    stream: streamAgy,
    streamSimple: streamAgy,
  };
}

export { API_ID, PROVIDER_ID };
