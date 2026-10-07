import { lstatSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { canonicalDefaultMode, type DefaultMode } from './modes.ts';

const REPO_CONFIG_CANDIDATES = ['.caveman/config.json', '.caveman.json'];
const MAX_WALK_DEPTH = 64;

export interface ConfigEnvironment {
  readonly env: NodeJS.ProcessEnv;
  readonly platform: NodeJS.Platform;
  readonly home: string;
}

const processEnvironment = (): ConfigEnvironment => ({ env: process.env, platform: process.platform, home: homedir() });

export function userConfigPath(environment: ConfigEnvironment = processEnvironment()): string {
  const { env, platform, home } = environment;
  const xdg = env['XDG_CONFIG_HOME'];
  if (xdg) return join(xdg, 'caveman', 'config.json');
  if (platform === 'win32') return join(env['APPDATA'] ?? join(home, 'AppData', 'Roaming'), 'caveman', 'config.json');
  return join(home, '.config', 'caveman', 'config.json');
}

function isRegularFile(path: string): boolean {
  try {
    const stat = lstatSync(path);
    return stat.isFile() && !stat.isSymbolicLink();
  } catch {
    return false;
  }
}

export function findRepoConfigPath(start: string): string | null {
  let dir = resolve(start);
  for (let depth = 0; depth < MAX_WALK_DEPTH; depth++) {
    const found = REPO_CONFIG_CANDIDATES.map((rel) => join(dir, rel)).find(isRegularFile);
    if (found) return found;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

function readDefaultMode(path: string): DefaultMode | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (typeof parsed !== 'object' || parsed === null || !('defaultMode' in parsed)) return null;
    return canonicalDefaultMode(String(parsed.defaultMode));
  } catch {
    return null;
  }
}

export function getDefaultMode(cwd: string, environment: ConfigEnvironment = processEnvironment()): DefaultMode {
  const fromEnv = canonicalDefaultMode(environment.env['CAVEMAN_DEFAULT_MODE']);
  if (fromEnv) return fromEnv;
  const repoConfig = findRepoConfigPath(cwd);
  const fromRepo = repoConfig ? readDefaultMode(repoConfig) : null;
  if (fromRepo) return fromRepo;
  return readDefaultMode(userConfigPath(environment)) ?? 'caveman';
}
