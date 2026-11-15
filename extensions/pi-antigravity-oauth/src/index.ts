import { createProvider, type Provider } from '@earendil-works/pi-ai';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { PROVIDER_ID } from './cloudcode.ts';
import { createAntigravityCommand } from './command.ts';
import { keychainImportAvailable } from './keychain.ts';
import { baselineModels, createFetchModels } from './models.ts';
import { type AntigravityOAuthOptions, createAntigravityOAuth, GOOGLE_OAUTH, type OAuthEndpoints } from './oauth.ts';
import { createCloudCodeStream } from './stream.ts';

export function createAntigravityProvider(oauth: OAuthEndpoints = GOOGLE_OAUTH, options: AntigravityOAuthOptions = {}): Provider {
  const baseline = baselineModels(oauth.cloudCode);
  return createProvider({
    id: PROVIDER_ID,
    name: 'Google Antigravity',
    baseUrl: oauth.cloudCode,
    auth: { oauth: createAntigravityOAuth(oauth, options) },
    models: baseline,
    // A live model replaces the same-id baseline object, so object identity separates the two.
    filterModels: (models) => (models.some((model) => !baseline.includes(model)) ? models.filter((model) => !baseline.includes(model)) : models),
    fetchModels: createFetchModels(oauth.cloudCode),
    api: createCloudCodeStream(oauth.cloudCode),
  });
}

export default function (pi: ExtensionAPI) {
  pi.on('session_start', (event, ctx) => {
    if (event.reason === 'startup')
      ctx.ui.notify('pi-antigravity-oauth is deprecated and gets no more updates. Its replacement is a separate package: run `pi install npm:@justjoshn/pi-google-oauth-v2`, then `pi remove npm:@justjoshn/pi-antigravity-oauth`.', 'warning');
  });
  pi.registerProvider(createAntigravityProvider(GOOGLE_OAUTH, { offerKeychainImport: keychainImportAvailable() }));
  pi.registerCommand('antigravity', createAntigravityCommand(GOOGLE_OAUTH));
}
