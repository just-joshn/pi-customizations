export const PROVIDER_CONFIG = {
  id: 'custom-anthropic',
  api: 'custom-anthropic-api',
  baseUrl: 'https://api.anthropic.com',
  apiKey: '$CUSTOM_ANTHROPIC_API_KEY',
  catalogProviderId: 'anthropic',
  catalogApi: 'anthropic-messages',
  modelNameSuffix: ' (Custom)',
} as const;
