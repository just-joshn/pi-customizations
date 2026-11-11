const EXT = '/Users/josh-desktop/src/personal/pi-x-subscription-oauth-audit/extensions/pi-x-subscription-oauth/src/cursor';
const { refreshCursor, readMacKeychain, loginCursor, readKeychainCredential, KEYCHAIN_API_KEY_SERVICE, KEYCHAIN_ACCOUNT } = await import(`${EXT}/auth.ts`);
const sig = AbortSignal.timeout(30000);
const minted = await refreshCursor(sig, () => readMacKeychain(KEYCHAIN_API_KEY_SERVICE, KEYCHAIN_ACCOUNT));
console.log('refresh: expires in min', Math.round((minted.expires - Date.now()) / 60000), 'refresh field', minted.refresh === minted.access ? 'same as access' : minted.refresh === 'cursor-keychain' ? 'placeholder' : 'distinct');
const login = await loginCursor(sig, () => readKeychainCredential(), async () => { throw new Error('would spawn cursor-agent login'); });
console.log('login: from keychain, expires in min', Math.round((login.expires - Date.now()) / 60000));
const bad = await refreshCursor(sig, async () => 'crsr_invalid_audit_key').catch((e: Error) => e.message);
console.log('refresh with bad key:', bad);
