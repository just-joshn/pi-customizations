import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { homedir as osHomedir, userInfo } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import type { OAuthCredential } from '@earendil-works/pi-ai';

const execFileAsync = promisify(execFile);

/** Prod OAUTH_FILE_SUFFIX is empty. */
export const CLAUDE_OAUTH_FILE_SUFFIX = '';
/** Claude `JU()`: any `CLAUDE_CODE_CUSTOM_OAUTH_URL` selects the custom storage suffix. */
export const CLAUDE_CUSTOM_OAUTH_FILE_SUFFIX = '-custom-oauth';
const KEYCHAIN_TIMEOUT_MS = 2_000;
const MAX_CREDENTIALS_BYTES = 1_048_576;

export function claudeOauthFileSuffix(env: NodeJS.ProcessEnv = process.env): string {
  return env['CLAUDE_CODE_CUSTOM_OAUTH_URL'] ? CLAUDE_CUSTOM_OAUTH_FILE_SUFFIX : CLAUDE_OAUTH_FILE_SUFFIX;
}
/** Default keychain service suffix from Claude Code `KPe`. */
export const CLAUDE_KEYCHAIN_SERVICE_SUFFIX = '-credentials';
export const CLAUDE_KEYCHAIN_SERVICE_DEFAULT = `Claude Code${CLAUDE_OAUTH_FILE_SUFFIX}${CLAUDE_KEYCHAIN_SERVICE_SUFFIX}`;
export const CLAUDE_CREDENTIALS_FILENAME = '.credentials.json';

const ACCOUNT_PATTERN = /^[a-zA-Z0-9._-]+$/;

/** Claude Code's stored `claudeAiOauth` blob after boundary parse. */
export type ClaudeAiOauth = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scopes?: readonly string[];
};

export type ClaudeCredentialsLayout = {
  configDir: string;
  credentialsPath: string;
  keychainService: string;
  keychainAccount: string;
};

export type ClaudeCredentialReaders = {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  homedir?: () => string;
  username?: () => string;
  readKeychain?: (service: string, account: string) => Promise<string | undefined>;
  readPlaintext?: (path: string) => Promise<string | undefined>;
};

function envValue(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name];
  return value === undefined ? undefined : value;
}

/** Claude `Le()` / `dN()` config directory with NFC normalization. */
export function claudeConfigDir(env: NodeJS.ProcessEnv = process.env, homedir: () => string = osHomedir): string {
  const secure = envValue(env, 'CLAUDE_SECURESTORAGE_CONFIG_DIR');
  if (secure !== undefined) return (secure || join(homedir(), '.claude')).normalize('NFC');
  const configured = envValue(env, 'CLAUDE_CONFIG_DIR');
  return (configured ?? join(homedir(), '.claude')).normalize('NFC');
}

/** Claude `HW(KPe)` keychain service name. */
export function claudeKeychainService(env: NodeJS.ProcessEnv = process.env, homedir: () => string = osHomedir): string {
  const secure = envValue(env, 'CLAUDE_SECURESTORAGE_CONFIG_DIR');
  const configDir = claudeConfigDir(env, homedir);
  const useDefaultService = secure !== undefined ? !secure : envValue(env, 'CLAUDE_CONFIG_DIR') === undefined;
  const hashSuffix = useDefaultService ? '' : `-${createHash('sha256').update(configDir).digest('hex').slice(0, 8)}`;
  return `Claude Code${claudeOauthFileSuffix(env)}${CLAUDE_KEYCHAIN_SERVICE_SUFFIX}${hashSuffix}`;
}

/** Claude `iO()` keychain account. */
export function claudeKeychainAccount(env: NodeJS.ProcessEnv = process.env, username: () => string = () => userInfo().username): string {
  let name: string;
  try {
    name = envValue(env, 'USER') || username();
  } catch {
    name = 'claude-code-user';
  }
  return ACCOUNT_PATTERN.test(name) ? name : 'claude-code-user';
}

export function claudeCredentialsPath(env: NodeJS.ProcessEnv = process.env, homedir: () => string = osHomedir): string {
  return join(claudeConfigDir(env, homedir), CLAUDE_CREDENTIALS_FILENAME);
}

export function resolveClaudeCredentialsLayout(readers: ClaudeCredentialReaders = {}): ClaudeCredentialsLayout {
  const env = readers.env ?? process.env;
  const homedir = readers.homedir ?? osHomedir;
  const username = readers.username ?? (() => userInfo().username);
  return {
    configDir: claudeConfigDir(env, homedir),
    credentialsPath: claudeCredentialsPath(env, homedir),
    keychainService: claudeKeychainService(env, homedir),
    keychainAccount: claudeKeychainAccount(env, username),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Parse Claude's credentials JSON (keychain password or `.credentials.json`). */
export function parseClaudeCredentialsJson(raw: string): ClaudeAiOauth {
  let text = raw.trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    try {
      text = Buffer.from(text, 'hex').toString('utf8').trim();
      parsed = JSON.parse(text);
    } catch {
      throw new Error('Claude Code credentials are not valid JSON.');
    }
  }
  if (!isRecord(parsed)) throw new Error('Claude Code credentials must be a JSON object.');
  const oauth = parsed['claudeAiOauth'];
  if (!isRecord(oauth)) throw new Error('Claude Code credentials lack claudeAiOauth.');
  const accessToken = oauth['accessToken'];
  const refreshToken = oauth['refreshToken'];
  const expiresAt = oauth['expiresAt'];
  if (typeof accessToken !== 'string' || accessToken.length === 0) {
    throw new Error('Claude Code claudeAiOauth lacks accessToken.');
  }
  if (typeof refreshToken !== 'string' || refreshToken.length === 0) {
    throw new Error('Claude Code claudeAiOauth lacks refreshToken.');
  }
  if (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt)) {
    throw new Error('Claude Code claudeAiOauth lacks expiresAt.');
  }
  const scopes = oauth['scopes'];
  return {
    accessToken,
    refreshToken,
    expiresAt,
    ...(Array.isArray(scopes) && scopes.every((entry) => typeof entry === 'string') ? { scopes: scopes as string[] } : {}),
  };
}

/** Map Claude storage into a Pi oauth credential. Pi's store becomes authoritative after login persists it. */
export function toPiOAuthCredential(oauth: ClaudeAiOauth): OAuthCredential {
  return {
    type: 'oauth',
    access: oauth.accessToken,
    refresh: oauth.refreshToken,
    expires: oauth.expiresAt,
  };
}

async function defaultReadKeychain(service: string, account: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync('security', ['find-generic-password', '-a', account, '-w', '-s', service], {
      encoding: 'utf8',
      timeout: KEYCHAIN_TIMEOUT_MS,
    });
    const value = stdout.trim();
    return value.length > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

/** Claude's file store: O_NOFOLLOW, regular files only, at most 1 MiB. A symlink, directory or oversized file reads as absent. */
async function defaultReadPlaintext(path: string): Promise<string | undefined> {
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
    if (code === 'ENOENT' || code === 'ENOTDIR' || code === 'ELOOP' || code === 'EISDIR') return undefined;
    throw error;
  }
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > MAX_CREDENTIALS_BYTES) return undefined;
    return await handle.readFile('utf8');
  } finally {
    await handle.close();
  }
}

/**
 * Opt-in read of Claude Code keychain / `.credentials.json`.
 * Prefers macOS keychain on darwin, then plaintext. Never shells to `claude`.
 */
export async function importClaudeAiOauth(readers: ClaudeCredentialReaders = {}): Promise<OAuthCredential> {
  const platform = readers.platform ?? process.platform;
  const layout = resolveClaudeCredentialsLayout(readers);
  const readKeychain = readers.readKeychain ?? defaultReadKeychain;
  const readPlaintext = readers.readPlaintext ?? defaultReadPlaintext;

  if (platform === 'darwin') {
    const fromKeychain = await readKeychain(layout.keychainService, layout.keychainAccount);
    if (fromKeychain !== undefined) return toPiOAuthCredential(parseClaudeCredentialsJson(fromKeychain));
  }

  const fromFile = await readPlaintext(layout.credentialsPath);
  if (fromFile !== undefined) return toPiOAuthCredential(parseClaudeCredentialsJson(fromFile));

  throw new Error('No Claude Code credentials found to import.');
}
