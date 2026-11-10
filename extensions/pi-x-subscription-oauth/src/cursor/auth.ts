import { execFile, spawn } from 'node:child_process';

import type { OAuthCredential } from '@earendil-works/pi-ai';
import { CURSOR_BIN_HINT, CURSOR_LOGIN_HINT } from './catalog.ts';

export const KEYCHAIN_ACCESS_SERVICE = 'cursor-access-token';
export const KEYCHAIN_REFRESH_SERVICE = 'cursor-refresh-token';
export const KEYCHAIN_ACCOUNT = 'cursor-user';
const KEYCHAIN_PLACEHOLDER = 'cursor-keychain';

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

export async function loginCursor(signal: AbortSignal, readSession: () => Promise<OAuthCredential | undefined>, runLogin: (signal: AbortSignal) => Promise<void>): Promise<OAuthCredential> {
  const existing = await readSession();
  if (existing?.access) return existing;
  try {
    await runLogin(signal);
  } catch (error) {
    throw new Error(scrubText(error instanceof Error ? error.message : CURSOR_LOGIN_HINT));
  }
  const created = await readSession();
  if (!created?.access) throw new Error(CURSOR_LOGIN_HINT);
  return created;
}

export async function refreshCursor(signal: AbortSignal, readSession: () => Promise<OAuthCredential | undefined>): Promise<OAuthCredential> {
  if (signal.aborted) throw new Error('Login cancelled');
  const next = await readSession();
  if (!next?.access) throw new Error(CURSOR_LOGIN_HINT);
  return next;
}
