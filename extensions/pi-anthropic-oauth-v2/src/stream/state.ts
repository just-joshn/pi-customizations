import type { Api, AssistantMessage, AssistantMessageEvent, Model, Tool } from '@earendil-works/pi-ai';
import { EMPTY_USAGE } from './usage.ts';

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
  readonly isOAuth: boolean;
  readonly tools: readonly Tool[];
};

export type ContentBlock = AssistantMessage['content'][number];

export function createStreamState(model: Model<Api>): StreamState {
  const output: AssistantMessage = {
    role: 'assistant',
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: EMPTY_USAGE,
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
