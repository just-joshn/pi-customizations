import { createProvider, type Provider } from '@earendil-works/pi-ai';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { PROVIDER_ID } from './cloudcode.ts';
import { createAntigravityCommand } from './command.ts';
import { baselineModels, createFetchModels } from './models.ts';
import { createAntigravityOAuth, GOOGLE_OAUTH, type OAuthEndpoints } from './oauth.ts';
import { createCloudCodeStream } from './stream.ts';

export function createAntigravityProvider(oauth: OAuthEndpoints = GOOGLE_OAUTH): Provider {
  return createProvider({
    id: PROVIDER_ID,
    name: 'Google Antigravity',
    baseUrl: oauth.cloudCode,
    auth: { oauth: createAntigravityOAuth(oauth) },
    models: baselineModels(oauth.cloudCode),
    fetchModels: createFetchModels(oauth.cloudCode),
    api: createCloudCodeStream(oauth.cloudCode),
  });
}

export default function (pi: ExtensionAPI) {
  pi.registerProvider(createAntigravityProvider());
  pi.registerCommand('antigravity', createAntigravityCommand(GOOGLE_OAUTH));
}
