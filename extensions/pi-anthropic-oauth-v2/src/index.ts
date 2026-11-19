/**
 * Custom Anthropic provider, adapted from Pi's custom-provider-anthropic example.
 *
 * Registers "custom-anthropic" with OAuth login (/login custom-anthropic) or an API key
 * from CUSTOM_ANTHROPIC_API_KEY, then use /model to select custom-anthropic/claude-sonnet-4-5.
 */

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { OAUTH_CONFIG } from './oauth/config.ts';
import { loginAnthropic, refreshAnthropicToken } from './oauth/login.ts';
import { PROVIDER_CONFIG, PROVIDER_MODELS } from './provider/config.ts';
import { streamCustomAnthropic } from './stream/stream.ts';

export default function (pi: ExtensionAPI) {
  try {
    pi.registerProvider(PROVIDER_CONFIG.id, {
      baseUrl: PROVIDER_CONFIG.baseUrl,
      apiKey: PROVIDER_CONFIG.apiKey,
      api: PROVIDER_CONFIG.api,
      models: [...PROVIDER_MODELS],
      oauth: {
        name: OAUTH_CONFIG.name,
        login: loginAnthropic,
        refreshToken: refreshAnthropicToken,
        getApiKey: (credentials) => credentials.access,
      },
      streamSimple: streamCustomAnthropic,
    });
  } catch (error) {
    console.error('Custom Anthropic provider registration failed:', error);
    throw new Error(`Could not register the ${PROVIDER_CONFIG.id} provider.`, { cause: error });
  }
}
