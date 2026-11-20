const ANTHROPIC_BASE_URL = 'https://api.anthropic.com';

export const PROVIDER_CONFIG = {
  id: 'custom-anthropic',
  api: 'custom-anthropic-api',
  baseUrl: ANTHROPIC_BASE_URL,
  apiKey: '$CUSTOM_ANTHROPIC_API_KEY',
  catalogProviderId: 'anthropic',
  catalogApi: 'anthropic-messages',
  modelNameSuffix: ' (Custom)',
} as const;
