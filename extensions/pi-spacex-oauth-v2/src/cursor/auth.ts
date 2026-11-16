import { createHash, randomBytes, randomUUID } from 'node:crypto';

import type { OAuthCredentials, OAuthLoginCallbacks } from '@earendil-works/pi-ai';

export const CURSOR_API = 'https://api2.cursor.sh';
const CURSOR_WEBSITE = 'https://cursor.com';
// biome-ignore lint/security/noSecrets: Cursor's public desktop OAuth client ID must match the IDE's refresh grant.
const CURSOR_CLIENT_ID = 'KbZUR41cY7W6zRSdpSUJ7I7mLYBKOCmB';

const base64url = (buf: Buffer) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

export function jwtExpiry(token: string): number {
  const payload = token.split('.')[1];
  if (!payload) throw new Error('Cursor returned a token that is not a JWT');
  const { exp } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { exp?: number };
  if (!exp) throw new Error('Cursor token has no expiry');
  return exp * 1000;
}

export function loginUrl(challenge: string, uuid: string): string {
  const url = new URL('/loginDeepControl', CURSOR_WEBSITE);
  url.searchParams.set('challenge', challenge);
  url.searchParams.set('uuid', uuid);
  url.searchParams.set('mode', 'login');
  url.searchParams.set('redirectTarget', 'cli');
  return url.toString();
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });

export async function cursorLogin(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash('sha256').update(verifier).digest());
  const uuid = randomUUID();
  callbacks.onAuth({ url: loginUrl(challenge, uuid), instructions: 'Sign in to Cursor in the browser, then return here.' });
  // Same schedule as cursor-agent: 404 means not approved yet, back off 1s * 1.2^n up to 10s, 150 tries.
  for (let attempt = 0; attempt < 150; attempt++) {
    const res = await fetch(`${CURSOR_API}/auth/poll?uuid=${uuid}&verifier=${verifier}`, { ...(callbacks.signal ? { signal: callbacks.signal } : {}) });
    if (res.ok) {
      const body = (await res.json()) as { accessToken?: string; refreshToken?: string };
      if (!body.accessToken || !body.refreshToken) throw new Error('Cursor sign-in finished without a Cursor access token');
      return { access: body.accessToken, refresh: body.refreshToken, expires: jwtExpiry(body.accessToken) };
    }
    if (res.status !== 404) throw new Error(`Cursor sign-in failed: HTTP ${res.status}`);
    await sleep(Math.min(1000 * 1.2 ** attempt, 10_000), callbacks.signal);
  }
  throw new Error('Cursor sign-in timed out before it was approved');
}

export async function cursorRefresh(credentials: OAuthCredentials, signal: AbortSignal): Promise<OAuthCredentials> {
  const res = await fetch(`${CURSOR_API}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ grant_type: 'refresh_token', client_id: CURSOR_CLIENT_ID, refresh_token: credentials.refresh }),
    signal,
  });
  if (!res.ok && res.status >= 500) throw new Error(`Cursor token refresh failed: HTTP ${res.status}`);
  const body = (await res.json()) as { access_token?: string; refresh_token?: string; shouldLogout?: boolean; error?: string };
  if (body.shouldLogout) throw new Error(`Cursor ended this sign-in${body.error ? `: ${body.error}` : ''}. Run /login again.`);
  if (!body.access_token) throw new Error(`Cursor token refresh failed: HTTP ${res.status}`);
  return { ...credentials, access: body.access_token, refresh: body.refresh_token ?? credentials.refresh, expires: jwtExpiry(body.access_token) };
}
