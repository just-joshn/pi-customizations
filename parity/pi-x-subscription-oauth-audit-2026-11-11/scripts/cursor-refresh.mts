import { KEYCHAIN_ACCOUNT, KEYCHAIN_API_KEY_SERVICE, loginCursor, readKeychainCredential, readMacKeychain, refreshCursor } from '../../../extensions/pi-x-subscription-oauth/src/cursor/auth.ts';

// Exercises the extension's refresh and login against the real keychain. Prints lifetimes only, never tokens.
const signal = AbortSignal.timeout(30_000);
const minutesLeft = (expires: number) => Math.round((expires - Date.now()) / 60_000);

const minted = await refreshCursor(signal, () => readMacKeychain(KEYCHAIN_API_KEY_SERVICE, KEYCHAIN_ACCOUNT));
console.log('refresh: expires in min', minutesLeft(minted.expires), 'refresh field', minted.refresh === minted.access ? 'same as access' : 'distinct');

// Same wiring as provider.ts: keychain session first, then the API-key exchange, then cursor-agent login.
const keychain = await readKeychainCredential();
const login = await loginCursor(
  signal,
  async () => keychain,
  async () => {
    throw new Error('would spawn cursor-agent login');
  },
  () => refreshCursor(signal, () => readMacKeychain(KEYCHAIN_API_KEY_SERVICE, KEYCHAIN_ACCOUNT)),
);
const keychainFresh = keychain !== undefined && keychain.expires > Date.now() + 300_000;
console.log('login: keychain session', keychainFresh ? 'fresh' : 'stale', '- returned session expires in min', minutesLeft(login.expires));

const rejected = await refreshCursor(signal, async () => 'crsr_invalid_audit_key').catch((error: unknown) => (error instanceof Error ? error.message : String(error)));
console.log('refresh with bad key:', rejected);
