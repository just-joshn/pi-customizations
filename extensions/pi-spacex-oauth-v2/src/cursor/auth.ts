import { Cursor } from '@cursor/sdk';
import type { OAuthCredentials, OAuthLoginCallbacks } from '@earendil-works/pi-ai';
import { CURSOR_CONFIG } from './config.ts';

/**
 * Cursor.auth.login() opens Cursor's browser sign-in and mints a user API key. `store: null` keeps the key
 * out of ~/.cursor/sdk/auth.json, so Pi's own credential store is the only copy.
 */
export async function loginCursor(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
  const { apiKey, apiKeyExpiresAtMs } = await Cursor.auth.login({
    store: null,
    openBrowser: false,
    onLoginUrl: (url) => callbacks.onAuth({ url, instructions: 'Sign in to Cursor in the browser, then return here.' }),
    apiKeyName: CURSOR_CONFIG.apiKeyName,
    ...(callbacks.signal ? { signal: callbacks.signal } : {}),
  });
  return { access: apiKey, refresh: '', expires: apiKeyExpiresAtMs };
}

/** A minted key cannot be refreshed. It lasts 90 days, then the user signs in again. */
export async function refreshCursorKey(_credentials: OAuthCredentials): Promise<OAuthCredentials> {
  throw new Error('Your Cursor API key from /login has expired. Run /login and choose Cursor (X subscription) to sign in again.');
}
