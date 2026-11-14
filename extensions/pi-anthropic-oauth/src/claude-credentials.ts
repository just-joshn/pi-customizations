import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { homedir as osHomedir, userInfo } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import type { OAuthCredential } from '@earendil-works/pi-ai';
import { type Static, Type } from 'typebox';
import { Check } from 'typebox/value';
import { invalidFields } from './schema.ts';

const execFileAsync = promisify(execFile);

export const CLAUDE_OAUTH_FILE_SUFFIX = '';
export const CLAUDE_CUSTOM_OAUTH_FILE_SUFFIX = '-custom-oauth';
const KEYCHAIN_TIMEOUT_MS = 2_000;
const MAX_CREDENTIALS_BYTES = 1_048_576;

export function claudeOauthFileSuffix(env: NodeJS.ProcessEnv = process.env): string {
  return env['CLAUDE_CODE_CUSTOM_OAUTH_URL'] ? CLAUDE_CUSTOM_OAUTH_FILE_SUFFIX : CLAUDE_OAUTH_FILE_SUFFIX;
}
export const CLAUDE_KEYCHAIN_SERVICE_SUFFIX = '-credentials';
export const CLAUDE_KEYCHAIN_SERVICE_DEFAULT = `Claude Code${CLAUDE_OAUTH_FILE_SUFFIX}${CLAUDE_KEYCHAIN_SERVICE_SUFFIX}`;
export const CLAUDE_CREDENTIALS_FILENAME = '.credentials.json';

const ACCOUNT_PATTERN = /^[a-zA-Z0-9._-]+$/;

const ClaudeCredentialsFile = Type.Object({
  claudeAiOauth: Type.Object({
    accessToken: Type.String({ minLength: 1 }),
    refreshToken: Type.String({ minLength: 1 }),
    expiresAt: Type.Number(),
  }),
});

// Claude tolerates a malformed scope list, so the import drops it instead of failing.
const Scopes = Type.Array(Type.String());

export type ClaudeAiOauth = Static<typeof ClaudeCredentialsFile>['claudeAiOauth'] & { scopes?: readonly string[] };

// Checked in this order, so a blob missing several fields names the first, as Claude does.
const CREDENTIAL_FIELD_ERRORS: readonly (readonly [field: string, message: string])[] = [
  ['', 'Claude Code credentials must be a JSON object.'],
  ['claudeAiOauth', 'Claude Code credentials lack claudeAiOauth.'],
  ['accessToken', 'Claude Code claudeAiOauth lacks accessToken.'],
  ['refreshToken', 'Claude Code claudeAiOauth lacks refreshToken.'],
  ['expiresAt', 'Claude Code claudeAiOauth lacks expiresAt.'],
];

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
  readKeychain?: (item: { service: string; account: string }) => Promise<string | undefined>;
  readPlaintext?: (path: string) => Promise<string | undefined>;
};

function envValue(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name];
  return value === undefined ? undefined : value;
}

export function claudeConfigDir(env: NodeJS.ProcessEnv = process.env, homedir: () => string = osHomedir): string {
  const secure = envValue(env, 'CLAUDE_SECURESTORAGE_CONFIG_DIR');
  if (secure !== undefined) return (secure || join(homedir(), '.claude')).normalize('NFC');
  const configured = envValue(env, 'CLAUDE_CONFIG_DIR');
  return (configured ?? join(homedir(), '.claude')).normalize('NFC');
}

export function claudeKeychainService(env: NodeJS.ProcessEnv = process.env, homedir: () => string = osHomedir): string {
  const secure = envValue(env, 'CLAUDE_SECURESTORAGE_CONFIG_DIR');
  const configDir = claudeConfigDir(env, homedir);
  const useDefaultService = secure !== undefined ? !secure : envValue(env, 'CLAUDE_CONFIG_DIR') === undefined;
  const hashSuffix = useDefaultService ? '' : `-${createHash('sha256').update(configDir).digest('hex').slice(0, 8)}`;
  return `Claude Code${claudeOauthFileSuffix(env)}${CLAUDE_KEYCHAIN_SERVICE_SUFFIX}${hashSuffix}`;
}

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
  if (!Check(ClaudeCredentialsFile, parsed)) {
    const invalid = invalidFields(ClaudeCredentialsFile, parsed);
    const [, message] = CREDENTIAL_FIELD_ERRORS.find(([field]) => invalid.has(field)) ?? ['', 'Claude Code credentials are malformed.'];
    throw new Error(message);
  }
  const { accessToken, refreshToken, expiresAt } = parsed.claudeAiOauth;
  const scopes: unknown = 'scopes' in parsed.claudeAiOauth ? parsed.claudeAiOauth.scopes : undefined;
  return { accessToken, refreshToken, expiresAt, ...(Check(Scopes, scopes) ? { scopes } : {}) };
}

export function toPiOAuthCredential(oauth: ClaudeAiOauth): OAuthCredential {
  return {
    type: 'oauth',
    access: oauth.accessToken,
    refresh: oauth.refreshToken,
    expires: oauth.expiresAt,
  };
}

async function defaultReadKeychain({ service, account }: { service: string; account: string }): Promise<string | undefined> {
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

export async function importClaudeAiOauth(readers: ClaudeCredentialReaders = {}): Promise<OAuthCredential> {
  const platform = readers.platform ?? process.platform;
  const layout = resolveClaudeCredentialsLayout(readers);
  const readKeychain = readers.readKeychain ?? defaultReadKeychain;
  const readPlaintext = readers.readPlaintext ?? defaultReadPlaintext;

  if (platform === 'darwin') {
    const fromKeychain = await readKeychain({ service: layout.keychainService, account: layout.keychainAccount });
    if (fromKeychain !== undefined) return toPiOAuthCredential(parseClaudeCredentialsJson(fromKeychain));
  }

  const fromFile = await readPlaintext(layout.credentialsPath);
  if (fromFile !== undefined) return toPiOAuthCredential(parseClaudeCredentialsJson(fromFile));

  throw new Error('No Claude Code credentials found to import.');
}
