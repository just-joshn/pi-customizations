import { createProvider, type Provider } from '@earendil-works/pi-ai';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { CLOUD_CODE_ENDPOINTS, PROVIDER_ID } from './cloudcode.ts';
import { createAntigravityCommand } from './command.ts';
import { baselineModels, createFetchModels } from './models.ts';
import { createAntigravityOAuth, GOOGLE_OAUTH, type OAuthEndpoints } from './oauth.ts';
import { createCloudCodeStream } from './stream.ts';

export interface AntigravityConfig {
  endpoints: readonly string[];
  oauth: OAuthEndpoints;
}

const DEFAULT_CONFIG: AntigravityConfig = { endpoints: CLOUD_CODE_ENDPOINTS, oauth: GOOGLE_OAUTH };

export function createAntigravityProvider(config: AntigravityConfig = DEFAULT_CONFIG): Provider {
  const baseEndpoint = config.endpoints[0] ?? CLOUD_CODE_ENDPOINTS[0];
  return createProvider({
    id: PROVIDER_ID,
    name: 'Google Antigravity',
    baseUrl: baseEndpoint,
    auth: { oauth: createAntigravityOAuth(config.oauth) },
    models: baselineModels(baseEndpoint),
    fetchModels: createFetchModels(config.endpoints),
    api: createCloudCodeStream(config.endpoints),
  });
}

export default function (pi: ExtensionAPI) {
  pi.registerProvider(createAntigravityProvider());
  pi.registerCommand('antigravity', createAntigravityCommand({ cloudCode: DEFAULT_CONFIG.endpoints, userInfoUrl: DEFAULT_CONFIG.oauth.userInfoUrl }));
}
