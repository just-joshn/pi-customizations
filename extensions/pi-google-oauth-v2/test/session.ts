import {
  type AssistantMessageEventStream,
  type Credential,
  createModels,
  InMemoryCredentialStore,
  InMemoryModelsStore,
  type Message,
  type Model,
  type ModelAuth,
  type MutableModels,
  type OAuthAuth,
  type OAuthCredential,
  type Provider,
  type SimpleStreamOptions,
  type TranscriptContext,
} from '@earendil-works/pi-ai';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { vi } from 'vitest';
import extension from '../src/index.ts';
import type { Catalog } from '../src/models.ts';
import { CREDENTIAL_TTL_MS, PROVIDER_ID, ROUTE_CATALOG, ROUTE_STREAM } from './constants.ts';
import { type GoogleFake, installGoogle, json, type Routes } from './google.ts';
import { sseResponse, stopChunk } from './sse.ts';

type ExtensionFactory = (pi: ExtensionAPI) => void;

/** Loads an extension the way Pi does and returns every provider it registered. */
export function loadProviders(factory: ExtensionFactory = extension): Provider[] {
  const registerProvider = vi.fn<(provider: Provider) => void>();
  factory({ registerProvider } as unknown as ExtensionAPI);
  return registerProvider.mock.calls.map(([provider]) => provider);
}

export function loadProvider(factory: ExtensionFactory = extension): Provider {
  const [provider] = loadProviders(factory);
  if (!provider) throw new Error('extension registered no provider');
  return provider;
}

export function oauthOf(provider: Provider): OAuthAuth {
  const { oauth } = provider.auth;
  if (!oauth) throw new Error('provider has no OAuth login');
  return oauth;
}

export const liveCredential = (overrides: Partial<OAuthCredential> = {}): OAuthCredential => ({
  type: 'oauth',
  access: 'access-live',
  refresh: 'refresh-live',
  expires: Date.now() + CREDENTIAL_TTL_MS,
  projectId: 'proj-77',
  ...overrides,
});

export interface SessionOptions {
  routes?: Routes;
  catalog?: Catalog | undefined;
  credential?: Credential | undefined;
  modelsStore?: InMemoryModelsStore;
  extension?: ExtensionFactory;
}

export interface Session {
  google: GoogleFake;
  provider: Provider;
  models: MutableModels;
  credentials: InMemoryCredentialStore;
  modelsStore: InMemoryModelsStore;
  model(id: string): Model<string>;
  stream(model: Model<string>, messages: Message[], options?: SimpleStreamOptions): Promise<AssistantMessageEventStream>;
}

const okReply = () => sseResponse(`data: ${JSON.stringify(stopChunk())}\n\n`);

/**
 * Boots the extension on a real Pi `Models` runtime, a fake Google behind the global fetch, and an in-memory
 * credential store. With a `catalog` the account's models are fetched through `Models.refresh`.
 */
export async function startSession(options: SessionOptions = {}): Promise<Session> {
  const catalogRoute: Routes = options.catalog ? { [ROUTE_CATALOG]: () => json(options.catalog) } : {};
  const google = installGoogle({ [ROUTE_STREAM]: okReply, ...catalogRoute, ...options.routes });
  const credentials = new InMemoryCredentialStore();
  const credential = 'credential' in options ? options.credential : liveCredential();
  if (credential) await credentials.modify(PROVIDER_ID, async () => credential);
  const modelsStore = options.modelsStore ?? new InMemoryModelsStore();
  const models = createModels({ credentials, modelsStore });
  const provider = loadProvider(options.extension);
  models.setProvider(provider);
  if (options.catalog) await models.refresh({ allowNetwork: true });
  return {
    google,
    provider,
    models,
    credentials,
    modelsStore,
    model: (id) => {
      const found = models.getModel(PROVIDER_ID, id);
      if (!found) throw new Error(`no model ${id}`);
      return found;
    },
    stream: async (model, messages, streamOptions = {}) => {
      const auth: ModelAuth = credential?.type === 'oauth' ? await oauthOf(provider).toAuth(credential) : {};
      return provider.streamSimple(model, { messages } as TranscriptContext, { ...auth, ...streamOptions, headers: { ...auth.headers, ...streamOptions.headers } });
    },
  };
}
