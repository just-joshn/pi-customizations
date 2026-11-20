import { existsSync, readFileSync } from 'node:fs';
import * as path from 'node:path';

import { CONFIG_DIR_NAME } from '@earendil-works/pi-coding-agent';
import { z } from 'zod';

export const SHARED_BUILD_CACHE_FLAG = 'gondolin-shared-build-cache';
export const SHARED_BUILD_CACHE_ENV = 'PI_GONDOLIN_SHARED_BUILD_CACHE';
export const GONDOLIN_CONFIG_FILENAME = 'gondolin.json';

export type GondolinConfig = { readonly enableSharedBuildCache: boolean };

export const GondolinConfigFileSchema = z.object({ enableSharedBuildCache: z.boolean().optional() });

export type GondolinConfigOptions = { localCwd: string; agentDir: string; env?: NodeJS.ProcessEnv; flag?: unknown };

const ENV_VALUES: Readonly<Record<string, boolean>> = { '1': true, true: true, '0': false, false: false };

function envSetting(env: NodeJS.ProcessEnv): boolean | undefined {
  const raw = env[SHARED_BUILD_CACHE_ENV]?.trim().toLowerCase();
  return raw !== undefined && Object.hasOwn(ENV_VALUES, raw) ? ENV_VALUES[raw] : undefined;
}

/** A missing file reads as no setting. A file that exists but is malformed throws, naming the file. */
function fileSetting(file: string): boolean | undefined {
  if (!existsSync(file)) return undefined;
  try {
    return GondolinConfigFileSchema.parse(JSON.parse(readFileSync(file, 'utf8'))).enableSharedBuildCache;
  } catch (error) {
    throw new Error(`Invalid Gondolin config ${file}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
}

/** Precedence: CLI flag, environment variable, project config, user config, then off. */
export function resolveGondolinConfig({ localCwd, agentDir, env = {}, flag }: GondolinConfigOptions): GondolinConfig {
  const fromEnv = envSetting(env);
  const enableSharedBuildCache = flag === true || (fromEnv ?? fileSetting(path.join(localCwd, CONFIG_DIR_NAME, GONDOLIN_CONFIG_FILENAME)) ?? fileSetting(path.join(agentDir, GONDOLIN_CONFIG_FILENAME)) ?? false);
  return { enableSharedBuildCache };
}
