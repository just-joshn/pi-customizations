import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';

import { pyStem } from './py.ts';

export const IS_WINDOWS = process.platform === 'win32';

// Compressing ships raw bytes to a third-party model, so likely secrets are a
// hard refuse before read.
const SENSITIVE_BASENAME_REGEX = /^(\.env(\..+)?|\.netrc|credentials(\..+)?|secrets?(\..+)?|passwords?(\..+)?|id_(rsa|dsa|ecdsa|ed25519)(\.pub)?|authorized_keys|known_hosts|.*\.(pem|key|p12|pfx|crt|cer|jks|keystore|asc|gpg))$/i;

const SENSITIVE_PATH_COMPONENTS: ReadonlySet<string> = new Set(['credential', 'credentials', 'secret', 'secrets']);

// Upstream lists these with their dot but compares dot-stripped names, so they never matched; compare them raw.
const SENSITIVE_DOT_DIRS: ReadonlySet<string> = new Set(['.ssh', '.aws', '.gnupg', '.kube', '.docker']);

const SENSITIVE_NAME_TOKENS: readonly string[] = ['secret', 'credential', 'password', 'passwd', 'apikey', 'accesskey', 'token', 'privatekey'];

function pathParts(filepath: string): string[] {
  const parts = filepath.split(IS_WINDOWS ? /[\\/]/ : /\//).filter((p) => p !== '');
  return filepath.startsWith('/') ? ['/', ...parts] : parts;
}

function isSensitiveComponent(part: string): boolean {
  return SENSITIVE_PATH_COMPONENTS.has(part) || SENSITIVE_NAME_TOKENS.some((token) => part.includes(token));
}

export function isSensitivePath(filepath: string): boolean {
  const parts = pathParts(filepath);
  const name = parts.at(-1) ?? '';
  if (SENSITIVE_BASENAME_REGEX.test(name)) return true;
  if (parts.some((part) => SENSITIVE_DOT_DIRS.has(part.toLowerCase()))) return true;
  const normalized = new Set(parts.map((part) => part.toLowerCase().replace(/[_\-\s.]/g, '')));
  return [...normalized].some(isSensitiveComponent);
}

function nonEmptyEnv(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined || value === '' ? undefined : value;
}

export function stateBaseDir(kind: 'backups' | 'locks'): string {
  const base = IS_WINDOWS ? (nonEmptyEnv('LOCALAPPDATA') ?? join(homedir(), 'AppData', 'Local')) : (nonEmptyEnv('XDG_DATA_HOME') ?? join(homedir(), '.local', 'share'));
  return join(base, 'caveman-compress', kind);
}

/** Out-of-tree so skill auto-loaders don't re-ingest `.original.md` backups. */
export function backupDirFor(filepath: string): string {
  return join(stateBaseDir('backups'), basename(dirname(filepath)));
}

export function backupPathFor(filepath: string): string {
  return join(backupDirFor(filepath), `${pyStem(basename(filepath))}.original.md`);
}
