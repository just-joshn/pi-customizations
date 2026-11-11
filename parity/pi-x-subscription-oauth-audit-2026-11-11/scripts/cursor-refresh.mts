import { readKeychainCredential } from '../../../extensions/pi-x-subscription-oauth/src/cursor/auth.ts';
import { createCursorProvider } from '../../../extensions/pi-x-subscription-oauth/src/cursor/provider.ts';

const signal = AbortSignal.timeout(30_000);
const minutesLeft = (expires: number) => Math.round((expires - Date.now()) / 60_000);
const neverLogin = async () => {
  throw new Error('would spawn cursor-agent login');
};

const oauth = createCursorProvider({ runLogin: neverLogin }).auth.oauth;
if (!oauth) throw new Error('The cursor provider has no OAuth auth.');
const unused = { type: 'oauth', access: '', refresh: '', expires: 0 } satisfies Parameters<typeof oauth.refresh>[0];

const minted = await oauth.refresh(unused, signal);
console.log('refresh: expires in min', minutesLeft(minted.expires), 'refresh field', minted.refresh === minted.access ? 'same as access' : 'distinct');

const keychain = await readKeychainCredential();
const login = await oauth.login({
  signal,
  notify: () => {},
  prompt: async () => {
    throw new Error('the Cursor login asked a question');
  },
});
const keychainFresh = keychain !== undefined && keychain.expires > Date.now() + 300_000;
console.log('login: keychain session', keychainFresh ? 'fresh' : 'stale', '- returned session expires in min', minutesLeft(login.expires));

const rejectingOauth = createCursorProvider({ runLogin: neverLogin, readApiKey: async () => 'crsr_invalid_audit_key' }).auth.oauth;
const rejected = await rejectingOauth?.refresh(unused, signal).catch((error: unknown) => (error instanceof Error ? error.message : String(error)));
console.log('refresh with bad key:', rejected);
