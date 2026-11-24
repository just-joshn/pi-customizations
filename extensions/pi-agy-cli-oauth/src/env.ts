import type { ProviderEnv } from '@earendil-works/pi-ai';
import { API_KEY_ENV_NAMES, INHERIT_API_KEY_ENV } from './constants.ts';

/** Whether a flag is set to something other than an explicit "off" value. */
export function envFlagEnabled(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return !!normalized && !['0', 'false', 'no', 'off'].includes(normalized);
}

function withoutApiKeys(env: Record<string, string>): Record<string, string> {
  const blocked: readonly string[] = API_KEY_ENV_NAMES;
  return Object.fromEntries(Object.entries(env).filter(([name]) => !blocked.includes(name)));
}

/**
 * The environment a spawned `agy` inherits.
 *
 * The parent environment is left untouched. Only the Gemini API-key variables are
 * dropped, because the CLI bills a key-backed turn to the paid API instead of the
 * signed-in plan, and inheriting one would change what a request costs without
 * saying so.
 */
export function childEnv(providerEnv: ProviderEnv | undefined): Record<string, string> {
  const inherited = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
  const merged: Record<string, string> = { ...inherited, ...providerEnv };
  return envFlagEnabled(merged[INHERIT_API_KEY_ENV]) ? merged : withoutApiKeys(merged);
}

/** Read one provider-scoped value, falling back to the process environment. */
export function envValue(env: ProviderEnv | undefined, name: string): string | undefined {
  const scoped = env?.[name];
  if (scoped !== undefined && scoped !== '') return scoped;
  const ambient = process.env[name];
  return ambient === undefined || ambient === '' ? undefined : ambient;
}
