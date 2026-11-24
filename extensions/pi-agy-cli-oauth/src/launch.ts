import type { ProviderEnv } from '@earendil-works/pi-ai';
import { APP_DATA_DIR_ENV, COMMAND_ENV, DEFAULT_COMMAND, GEMINI_DIR_ENV, TELEMETRY_ENV } from './constants.ts';
import { childEnv, envFlagEnabled, envValue } from './env.ts';

export interface LaunchSpec {
  command: string;
  args: readonly string[];
  env: Record<string, string>;
}

export interface LaunchOptions {
  /** Drop telemetry for a conversation worker. Discovery keeps it so the catalog is complete. */
  worker?: boolean;
}

/**
 * The argv and environment for one `agy acp` process.
 *
 * `agy` ships as a native binary on macOS, Linux, and Windows, so it is spawned
 * directly rather than through a shell or an npm launcher shim.
 */
export function launchSpec(providerEnv: ProviderEnv | undefined, options: LaunchOptions = {}): LaunchSpec {
  const geminiDir = envValue(providerEnv, GEMINI_DIR_ENV);
  const appDataDir = envValue(providerEnv, APP_DATA_DIR_ENV);
  const silent = options.worker === true && !envFlagEnabled(envValue(providerEnv, TELEMETRY_ENV));
  const args = ['acp', '--stdio', ...(geminiDir === undefined ? [] : ['--gemini-dir', geminiDir]), ...(appDataDir === undefined ? [] : ['--app-data-dir', appDataDir]), ...(silent ? ['--disable-telemetry'] : [])];
  return {
    command: envValue(providerEnv, COMMAND_ENV) ?? DEFAULT_COMMAND,
    args,
    env: childEnv(providerEnv),
  };
}
