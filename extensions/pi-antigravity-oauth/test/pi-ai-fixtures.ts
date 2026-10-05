import type { AssistantMessage, Model, Usage } from '@earendil-works/pi-ai';

export const googleModel: Model<'google-generative-ai'> = {
  id: 'gemini-3-flash',
  name: 'Gemini',
  api: 'google-generative-ai',
  provider: 'google',
  baseUrl: 'https://example.invalid',
  reasoning: true,
  input: ['text', 'image'],
  cost: { input: 1, output: 2, cacheRead: 0.5, cacheWrite: 1 },
  contextWindow: 10000,
  maxTokens: 4096,
};

export const usage: Usage = {
  input: 8,
  output: 4,
  cacheRead: 2,
  cacheWrite: 1,
  totalTokens: 15,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

export function assistant(overrides: Partial<AssistantMessage> = {}): AssistantMessage {
  return { role: 'assistant', api: googleModel.api, provider: googleModel.provider, model: googleModel.id, content: [{ type: 'text', text: 'done' }], usage, stopReason: 'stop', timestamp: 2, ...overrides };
}
