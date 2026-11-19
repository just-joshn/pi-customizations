import type { ProviderModelConfig } from '@earendil-works/pi-coding-agent';

export const PROVIDER_CONFIG = {
  id: 'custom-anthropic',
  api: 'custom-anthropic-api',
  baseUrl: 'https://api.anthropic.com',
  apiKey: '$CUSTOM_ANTHROPIC_API_KEY',
} as const;

export const PROVIDER_MODELS: readonly ProviderModelConfig[] = [
  {
    id: 'claude-opus-4-5',
    name: 'Claude Opus 4.5 (Custom)',
    reasoning: true,
    input: ['text', 'image'],
    cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
    contextWindow: 200000,
    maxTokens: 64000,
  },
  {
    id: 'claude-sonnet-4-5',
    name: 'Claude Sonnet 4.5 (Custom)',
    reasoning: true,
    input: ['text', 'image'],
    cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
    contextWindow: 200000,
    maxTokens: 64000,
  },
];
