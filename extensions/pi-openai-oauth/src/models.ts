import type { ProviderModelConfig } from '@earendil-works/pi-coding-agent';

/** Model ID that leaves the model to the signed-in account's configured Codex default. */
export const CODEX_DEFAULT_MODEL_ID = 'codex-default';

const FREE = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

// Codex returns only a final text response, so no model takes images or Pi's thinking levels.
export const MODELS: ProviderModelConfig[] = [
  {
    id: CODEX_DEFAULT_MODEL_ID,
    name: 'Codex (configured default)',
    reasoning: false,
    input: ['text'],
    cost: FREE,
    contextWindow: 400_000,
    maxTokens: 128_000,
  },
  {
    id: 'gpt-6.1-sol',
    name: 'GPT-6.1 Sol (Codex)',
    reasoning: false,
    input: ['text'],
    cost: FREE,
    contextWindow: 400_000,
    maxTokens: 128_000,
  },
];
