import type { AssistantMessageEvent } from '@earendil-works/pi-ai';
import type { ProviderConfig as PiProviderConfig } from '@earendil-works/pi-coding-agent';
import extension from '../../src/index.ts';
import { DEFAULT_MODEL_ID } from './constants.ts';
import { context } from './fixtures.ts';
import { lastCall } from './sdk-state.ts';

type Credentials = { refresh: string; access: string; expires: number };

export type ProviderConfig = {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly api: string;
  readonly models: readonly Record<string, unknown>[];
  readonly oauth: {
    readonly name: string;
    readonly login: (callbacks: unknown) => Promise<Credentials>;
    readonly refreshToken: (credentials: unknown, signal: AbortSignal) => Promise<Credentials>;
    readonly getApiKey: (credentials: { access: string }) => string;
  };
  readonly streamSimple: (model: unknown, context: unknown, options?: unknown) => AsyncIterable<AssistantMessageEvent>;
};

type Registration = { readonly name: string; readonly config: ProviderConfig };

const isFullConfig = (config: PiProviderConfig): config is PiProviderConfig & ProviderConfig =>
  typeof config.baseUrl === 'string' && typeof config.apiKey === 'string' && typeof config.api === 'string' && Array.isArray(config.models) && config.oauth !== undefined && typeof config.streamSimple === 'function';

export const register = (): Registration => {
  let entry: Registration | undefined;
  extension({
    registerProvider: (name: string, config: PiProviderConfig) => {
      if (!isFullConfig(config)) throw new Error('provider registered without models, OAuth, or a stream');
      entry = { name, config };
    },
  });
  if (!entry) throw new Error('provider not registered');
  return entry;
};

export const model = (id = DEFAULT_MODEL_ID) => {
  const { config } = register();
  return { ...config.models.find((entry) => entry['id'] === id), api: config.api, provider: 'custom-anthropic', baseUrl: config.baseUrl };
};

export const collect = async (iterable: AsyncIterable<AssistantMessageEvent>): Promise<readonly AssistantMessageEvent[]> => {
  let events: readonly AssistantMessageEvent[] = [];
  for await (const event of iterable) events = [...events, event];
  return events;
};

export const run = async (options: Record<string, unknown>, ctx = context(), modelId = DEFAULT_MODEL_ID) => {
  const { config } = register();
  const events = await collect(config.streamSimple(model(modelId), ctx, options));
  return { events, call: lastCall() };
};

export const terminal = (events: readonly AssistantMessageEvent[]) => {
  const last = events.at(-1);
  if (last?.type === 'done') return last.message;
  if (last?.type === 'error') return last.error;
  throw new Error('stream did not terminate');
};
