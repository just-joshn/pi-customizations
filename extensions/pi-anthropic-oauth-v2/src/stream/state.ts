import { type Api, type AssistantMessage, type AssistantMessageEvent, calculateCost, type Model, type Usage } from '@earendil-works/pi-ai';
import type { NameCodec } from '../tools/names.ts';

export type OpenBlock = {
  readonly contentIndex: number;
  readonly json: string;
};

export type StreamState = {
  readonly output: AssistantMessage;
  readonly blocks: ReadonlyMap<number, OpenBlock>;
};

export type StreamStep = {
  readonly state: StreamState;
  readonly events: readonly AssistantMessageEvent[];
};

export type StreamContext = {
  readonly model: Model<Api>;
  readonly names: NameCodec;
};

export type ContentBlock = AssistantMessage['content'][number];

type AnthropicUsage = {
  readonly input_tokens?: number | null;
  readonly output_tokens?: number | null;
  readonly cache_read_input_tokens?: number | null;
  readonly cache_creation_input_tokens?: number | null;
};

/** A new object each call, because Pi's cost helpers and consumers write into the usage they are given. */
export const emptyUsage = (): Usage => ({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
});

/** Anthropic reports usage twice, and the second report may leave a count out. A missing count keeps the earlier one. */
export function toUsage(model: Model<Api>, raw: AnthropicUsage, previous: Usage): Usage {
  const input = raw.input_tokens ?? previous.input;
  const output = raw.output_tokens ?? previous.output;
  const cacheRead = raw.cache_read_input_tokens ?? previous.cacheRead;
  const cacheWrite = raw.cache_creation_input_tokens ?? previous.cacheWrite;
  const counts = { input, output, cacheRead, cacheWrite, totalTokens: input + output + cacheRead + cacheWrite };
  return { ...counts, cost: calculateCost(model, { ...counts, cost: emptyUsage().cost }) };
}

export function createStreamState(model: Model<Api>): StreamState {
  const output: AssistantMessage = {
    role: 'assistant',
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: emptyUsage(),
    stopReason: 'pending',
    timestamp: Date.now(),
  };
  return { output, blocks: new Map() };
}

export const unchanged = (state: StreamState): StreamStep => ({ state, events: [] });

export function replaceBlock(output: AssistantMessage, contentIndex: number, block: ContentBlock): AssistantMessage {
  return { ...output, content: output.content.map((current, index) => (index === contentIndex ? block : current)) };
}

export const withOpenBlock = (blocks: ReadonlyMap<number, OpenBlock>, index: number, block: OpenBlock): ReadonlyMap<number, OpenBlock> => new Map([...blocks, [index, block]]);

export const withoutOpenBlock = (blocks: ReadonlyMap<number, OpenBlock>, index: number): ReadonlyMap<number, OpenBlock> => new Map([...blocks].filter(([key]) => key !== index));
