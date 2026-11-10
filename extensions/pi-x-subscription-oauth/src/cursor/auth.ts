import { execFile, spawn } from 'node:child_process';

import type { OAuthCredential } from '@earendil-works/pi-ai';
import { CURSOR_BASE_URL, CURSOR_BIN_HINT, CURSOR_LOGIN_HINT } from './catalog.ts';

export const KEYCHAIN_ACCESS_SERVICE = 'cursor-access-token';
export const KEYCHAIN_REFRESH_SERVICE = 'cursor-refresh-token';
export const KEYCHAIN_API_KEY_SERVICE = 'cursor-api-key';
export const KEYCHAIN_ACCOUNT = 'cursor-user';
const KEYCHAIN_PLACEHOLDER = 'cursor-keychain';
const EXCHANGE_URL = `${CURSOR_BASE_URL}/auth/exchange_user_api_key`;
/** Pi refreshes a stored token this early. A session inside the window is not usable. */
const SESSION_SKEW_MS = 5 * 60 * 1000;

const JWT_TEXT = /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g;

export function scrubText(text: string, secrets: readonly string[] = []): string {
  let out = text;
  for (const secret of secrets) {
    if (secret.length > 0) out = out.split(secret).join('[redacted]');
  }
  return out.replace(JWT_TEXT, '[redacted]').slice(0, 500);
}

export function expiresAt(access: string): number {
  const exp = jwtExpSeconds(access);
  if (exp === undefined) return Date.UTC(2100, 0, 1);
  return exp * 1000;
}

function jwtExpSeconds(access: string): number | undefined {
  const parts = access.split('.');
  if (parts.length < 2 || !parts[1]) return undefined;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as unknown;
    if (!payload || typeof payload !== 'object' || !('exp' in payload) || typeof payload.exp !== 'number') return undefined;
    return payload.exp;
  } catch {
    return undefined;
  }
}

export function credentialFrom(access: string, refresh: string | undefined): OAuthCredential {
  return { type: 'oauth', access, refresh: refresh && refresh.length > 0 ? refresh : KEYCHAIN_PLACEHOLDER, expires: expiresAt(access) };
}

export function readMacKeychain(service: string, account: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile('security', ['find-generic-password', '-s', service, '-a', account, '-w'], { timeout: 5000 }, (error, stdout) => {
      if (error) {
        resolve(undefined);
        return;
      }
      const value = stdout.trim();
      resolve(value.length > 0 ? value : undefined);
    });
  });
}

export async function readKeychainCredential(read: (service: string, account: string) => Promise<string | undefined> = readMacKeychain): Promise<OAuthCredential | undefined> {
  const access = await read(KEYCHAIN_ACCESS_SERVICE, KEYCHAIN_ACCOUNT);
  if (!access) return undefined;
  const refresh = await read(KEYCHAIN_REFRESH_SERVICE, KEYCHAIN_ACCOUNT);
  return credentialFrom(access, refresh);
}

export function runCursorAgentLogin(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (settle: () => void) => {
      if (settled) return;
      settled = true;
      settle();
    };
    const child = spawn('cursor-agent', ['login'], { stdio: 'inherit', signal });
    child.on('error', (error: NodeJS.ErrnoException) => {
      finish(() => {
        if (error.code === 'ENOENT') reject(new Error(CURSOR_BIN_HINT));
        else reject(new Error(scrubText(error.message)));
      });
    });
    child.on('exit', (code) => {
      finish(() => {
        if (code === 0) resolve();
        else reject(new Error('cursor-agent login failed. Run /login and choose Cursor.'));
      });
    });
  });
}

export type MintedSession = {
  readonly access: string;
  readonly refresh?: string;
};

export type ExchangeApiKey = (apiKey: string, signal: AbortSignal) => Promise<MintedSession>;

function sessionUsable(credential: OAuthCredential | undefined): credential is OAuthCredential {
  return credential !== undefined && credential.access.length > 0 && credential.expires > Date.now() + SESSION_SKEW_MS;
}

function mintedFrom(body: unknown): MintedSession | undefined {
  if (!body || typeof body !== 'object' || !('accessToken' in body) || typeof body.accessToken !== 'string' || body.accessToken.length === 0) return undefined;
  if ('refreshToken' in body && typeof body.refreshToken === 'string' && body.refreshToken.length > 0) return { access: body.accessToken, refresh: body.refreshToken };
  return { access: body.accessToken };
}

export async function exchangeCursorApiKey(apiKey: string, signal: AbortSignal, fetchImpl: typeof fetch = fetch): Promise<MintedSession> {
  const response = await fetchImpl(EXCHANGE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: '{}',
    redirect: 'error',
    signal,
  });
  if (!response.ok) throw new Error(CURSOR_LOGIN_HINT);
  const minted = mintedFrom(await response.json().catch(() => undefined));
  if (!minted) throw new Error(CURSOR_LOGIN_HINT);
  return minted;
}

export async function loginCursor(signal: AbortSignal, readSession: () => Promise<OAuthCredential | undefined>, runLogin: (signal: AbortSignal) => Promise<void>, mint?: () => Promise<OAuthCredential>): Promise<OAuthCredential> {
  const existing = await readSession();
  if (sessionUsable(existing)) return existing;
  if (mint) {
    try {
      const minted = await mint();
      if (sessionUsable(minted)) return minted;
    } catch (error) {
      if (signal.aborted || (error instanceof Error && (error.name === 'AbortError' || error.message === 'Login cancelled'))) throw new Error('Login cancelled');
    }
  }
  try {
    await runLogin(signal);
  } catch (error) {
    throw new Error(scrubText(error instanceof Error ? error.message : CURSOR_LOGIN_HINT));
  }
  const created = await readSession();
  if (!sessionUsable(created)) throw new Error(CURSOR_LOGIN_HINT);
  return created;
}

export async function refreshCursor(signal: AbortSignal, readApiKey: () => Promise<string | undefined>, exchange: ExchangeApiKey = exchangeCursorApiKey): Promise<OAuthCredential> {
  if (signal.aborted) throw new Error('Login cancelled');
  const apiKey = await readApiKey();
  if (!apiKey) throw new Error(CURSOR_LOGIN_HINT);
  try {
    const minted = await exchange(apiKey, signal);
    if (signal.aborted) throw new Error('Login cancelled');
    return credentialFrom(minted.access, minted.refresh);
  } catch (error) {
    if (signal.aborted || (error instanceof Error && (error.name === 'AbortError' || error.message === 'Login cancelled'))) throw new Error('Login cancelled');
    throw new Error(CURSOR_LOGIN_HINT);
  }
}
