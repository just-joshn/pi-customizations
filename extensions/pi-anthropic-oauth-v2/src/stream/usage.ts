import { type Api, calculateCost, type Model, type Usage } from '@earendil-works/pi-ai';

export type AnthropicUsage = {
  readonly input_tokens?: number | null;
  readonly output_tokens?: number | null;
  readonly cache_read_input_tokens?: number | null;
  readonly cache_creation_input_tokens?: number | null;
};

export const EMPTY_USAGE: Usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

export function toUsage(model: Model<Api>, raw: AnthropicUsage): Usage {
  const input = raw.input_tokens || 0;
  const output = raw.output_tokens || 0;
  const cacheRead = raw.cache_read_input_tokens || 0;
  const cacheWrite = raw.cache_creation_input_tokens || 0;
  const counts = { input, output, cacheRead, cacheWrite, totalTokens: input + output + cacheRead + cacheWrite };
  // calculateCost writes into the cost object it is given, so it gets a fresh one.
  const cost = calculateCost(model, { ...counts, cost: { ...EMPTY_USAGE.cost } });
  return { ...counts, cost };
}
