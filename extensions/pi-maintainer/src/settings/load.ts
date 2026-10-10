import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { BRANDING } from '../branding.ts';
import { createWorkingTree } from '../edit/working-tree.ts';
import { defaultConfigFiles, dotenvSearchPath, findGitRoot, parseConfigYaml } from './config-files.ts';
import { applyDotenv } from './dotenv.ts';
import { settingsOptions } from './options.ts';
import { type ConfigSource, type Resolution, resolveSettings } from './resolve.ts';
import type { AnyOptionSpec } from './spec.ts';

export interface SettingsInputs {
  readonly specs: readonly AnyOptionSpec[];
  readonly getFlag: (name: string) => boolean | string | undefined;
  readonly processEnvironment: Readonly<Record<string, string | undefined>>;
  readonly cwd: string;
  readonly home: string;
}

export interface LoadedSettings extends Resolution {
  /** The process environment with `.env` files applied, for commands pi-maintainer runs. */
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly gitRoot: string | null;
  readonly dotenvFiles: readonly string[];
}

async function readConfigs(paths: readonly string[], explicit: string | null): Promise<{ configs: ConfigSource[]; problems: string[] }> {
  const configs: ConfigSource[] = [];
  const problems: string[] = [];
  for (const path of explicit === null ? paths : [...paths, explicit]) {
    if (!existsSync(path)) {
      if (path === explicit) problems.push(`File not found: ${path}`);
      continue;
    }
    const parsed = parseConfigYaml(await readFile(path, 'utf8'), path);
    if (parsed.ok) configs.push({ path, entries: parsed.entries });
    else problems.push(`${path}: ${parsed.error}`);
  }
  return { configs, problems };
}

async function loadDotenvFiles(files: readonly string[], encoding: string, base: Readonly<Record<string, string | undefined>>): Promise<{ environment: Record<string, string | undefined>; loaded: string[]; problems: string[] }> {
  const problems: string[] = [];
  const notices = { output: () => {}, warning: () => {}, error: (message: string) => problems.push(`Error loading ${message}`) };
  const tree = createWorkingTree({ encoding, notices });
  let environment: Record<string, string | undefined> = { ...base };
  const loaded: string[] = [];
  for (const file of files) {
    if (!existsSync(file)) continue;
    const text = await tree.read(file);
    if (text === null) continue;
    environment = applyDotenv(text, environment);
    loaded.push(file);
  }
  return { environment, loaded, problems };
}

/**
 * Aider `main`'s two parses: settings from flags, the environment, and config files choose the
 * `.env` file and its encoding; the `.env` values then join the environment for the final parse.
 * `.env` values never reach Pi's own `process.env`.
 */
export async function loadSettings(inputs: SettingsInputs): Promise<LoadedSettings> {
  const gitRoot = findGitRoot(inputs.cwd);
  const explicitFlag = inputs.getFlag(settingsOptions.config.name);
  const explicit = typeof explicitFlag === 'string' ? resolve(inputs.cwd, explicitFlag) : null;
  const read = await readConfigs(defaultConfigFiles({ home: inputs.home, gitRoot, cwd: inputs.cwd }), explicit);
  const specs = [...inputs.specs, settingsOptions.envFile];
  const common = { getFlag: inputs.getFlag, environmentPrefix: BRANDING.envPrefix, configs: read.configs };
  const first = resolveSettings(specs, { ...common, environment: inputs.processEnvironment });
  const envFile = first.settings.value(settingsOptions.envFile) ?? (gitRoot ? join(gitRoot, '.env') : '.env');
  const encodingSpec = inputs.specs.find((spec) => spec.name === 'encoding');
  const encodingValue = encodingSpec === undefined ? null : first.settings.value(encodingSpec);
  const encoding = typeof encodingValue === 'string' ? encodingValue : 'utf-8';
  const dotenvFiles = dotenvSearchPath({ home: inputs.home, gitRoot, cwd: inputs.cwd, envFile });
  const dotenv = await loadDotenvFiles(dotenvFiles, encoding, inputs.processEnvironment);
  const final = resolveSettings(specs, { ...common, environment: dotenv.environment });
  return { settings: final.settings, problems: [...read.problems, ...dotenv.problems, ...final.problems], environment: dotenv.environment, gitRoot, dotenvFiles: dotenv.loaded };
}
