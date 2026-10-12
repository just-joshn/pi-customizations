import type { Api, Model, Provider, ProviderHeaders, ProviderStreams, StreamOptions } from '@earendil-works/pi-ai';

/** The proxy answers HTTP 426 below 1.0.13. Grok 1.0.50 sends this version; 1.0.46 still clears the gate. */
export const GROK_CLIENT_VERSION = '1.0.50';

export function grokHeaders(model: Pick<Model<Api>, 'id' | 'contextWindow'>, options: Pick<StreamOptions, 'headers' | 'sessionId'> | undefined): ProviderHeaders {
  return {
    'x-grok-client-version': GROK_CLIENT_VERSION,
    'X-XAI-Token-Auth': 'xai-grok-cli',
    'x-grok-model-override': model.id,
    'x-grok-context-window': String(model.contextWindow),
    ...(options?.sessionId ? { 'x-grok-conv-id': options.sessionId } : {}),
    ...options?.headers,
  };
}

export function withGrokHeaders(inner: Pick<Provider, 'stream' | 'streamSimple'>): ProviderStreams {
  return {
    stream: (model, context, options) => inner.stream(model, context, { ...options, headers: grokHeaders(model, options) }),
    streamSimple: (model, context, options) => inner.streamSimple(model, context, { ...options, headers: grokHeaders(model, options) }),
  };
}
