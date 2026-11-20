// A fake Pi host. It records what the extension registers so tests can drive it the way Pi does.

import type { Credential, ModelsPublication, ModelsStoreEntry, OAuthCredentials, OAuthLoginCallbacks, RefreshModelsContext } from '@earendil-works/pi-ai';
import type { ExtensionAPI, ExtensionContext, ProviderConfig } from '@earendil-works/pi-coding-agent';
import { vi } from 'vitest';
import piSpacexOauth from '../src/index.ts';
import { asHostType, rejection } from './support.ts';

export const GROK_ID = 'spacex-grok';
export const CURSOR_ID = 'spacex-cursor';
export const STATUS_KEY = 'spacex-usage';

type Handler = (event: unknown, ctx: ExtensionContext) => unknown;
type CommandHandler = (args: string, ctx: ExtensionContext) => Promise<void>;
type OAuth = NonNullable<ProviderConfig['oauth']>;
type RefreshModels = NonNullable<ProviderConfig['refreshModels']>;

export interface Provider {
  readonly config: ProviderConfig;
  readonly oauth: OAuth;
  readonly refreshModels: RefreshModels;
  readonly streamSimple: NonNullable<ProviderConfig['streamSimple']>;
}

export interface LoadedExtension {
  provider(id: string): Provider;
  providerIds(): string[];
  commandNames(): string[];
  runCommand(name: string, ctx: ExtensionContext, args?: string): Promise<void>;
  fire(event: string, payload: unknown, ctx: ExtensionContext): Promise<void>;
}

function required<T>(value: T | undefined, label: string): T {
  if (value === undefined) throw new Error(`the extension registered no ${label}`);
  return value;
}

export function loadExtension(): LoadedExtension {
  let providers = new Map<string, ProviderConfig>();
  let commands = new Map<string, CommandHandler>();
  let handlers = new Map<string, Handler[]>();
  const fakePi = {
    registerProvider: (id: string, config: ProviderConfig) => {
      providers = new Map([...providers, [id, config]]);
    },
    registerCommand: (name: string, def: { handler: CommandHandler }) => {
      commands = new Map([...commands, [name, def.handler]]);
    },
    on: (event: string, handler: Handler) => {
      handlers = new Map([...handlers, [event, [...(handlers.get(event) ?? []), handler]]]);
    },
  };
  piSpacexOauth(asHostType<ExtensionAPI>(fakePi, 'ExtensionAPI', ['registerProvider', 'registerCommand', 'on']));
  return {
    provider: (id) => {
      const config = required(providers.get(id), `provider ${id}`);
      return {
        config,
        oauth: required(config.oauth, `OAuth for ${id}`),
        refreshModels: async (context) => required(await config.refreshModels?.(context), `refreshModels result for ${id}`),
        streamSimple: (...args) => required(config.streamSimple, `streamSimple for ${id}`)(...args),
      };
    },
    providerIds: () => [...providers.keys()].toSorted(),
    commandNames: () => [...commands.keys()],
    runCommand: (name, ctx, args = '') => required(commands.get(name), `command ${name}`)(args, ctx),
    fire: async (event, payload, ctx) => {
      for (const handler of handlers.get(event) ?? []) await handler(payload, ctx);
    },
  };
}

export interface FakeContextOptions {
  provider?: string;
  tokens?: Record<string, string>;
  hasUI?: boolean;
  authFailure?: unknown;
}

export interface FakeContext {
  readonly ctx: ExtensionContext;
  readonly notifications: () => { message: string; level: string | undefined }[];
  readonly statuses: () => [string, string | undefined][];
}

/** The ExtensionContext Pi hands to handlers, recording notifications and footer statuses. */
export function makeContext(options: FakeContextOptions = {}): FakeContext {
  let notifications: ReturnType<FakeContext['notifications']> = [];
  let statuses: ReturnType<FakeContext['statuses']> = [];
  const getProviderAuth = (provider: string) => {
    if (options.authFailure !== undefined) return rejection(options.authFailure);
    const apiKey = options.tokens?.[provider];
    return Promise.resolve(apiKey ? { auth: { apiKey } } : undefined);
  };
  const fakeContext = {
    hasUI: options.hasUI ?? true,
    model: options.provider ? { provider: options.provider } : undefined,
    modelRegistry: { getProviderAuth },
    ui: {
      setStatus: (key: string, text: string | undefined) => {
        statuses = [...statuses, [key, text]];
      },
      notify: (message: string, level?: string) => {
        notifications = [...notifications, { message, level }];
      },
      theme: { fg: (_color: string, text: string) => `<${text}>` },
    },
  };
  const ctx = asHostType<ExtensionContext>(fakeContext, 'ExtensionContext', ['hasUI', 'model', 'modelRegistry', 'ui']);
  return { ctx, notifications: () => notifications, statuses: () => statuses };
}

export interface FakeLogin {
  readonly callbacks: OAuthLoginCallbacks;
  readonly deviceCodes: () => Parameters<OAuthLoginCallbacks['onDeviceCode']>[0][];
  readonly authUrls: () => Parameters<OAuthLoginCallbacks['onAuth']>[0][];
}

/** The callbacks Pi's /login screen passes to a provider's login flow. */
export function makeLogin(signal?: AbortSignal): FakeLogin {
  let deviceCodes: ReturnType<FakeLogin['deviceCodes']> = [];
  let authUrls: ReturnType<FakeLogin['authUrls']> = [];
  const fakeCallbacks = {
    onAuth: (info: ReturnType<FakeLogin['authUrls']>[number]) => {
      authUrls = [...authUrls, info];
    },
    onDeviceCode: (info: ReturnType<FakeLogin['deviceCodes']>[number]) => {
      deviceCodes = [...deviceCodes, info];
    },
    onPrompt: vi.fn(),
    onSelect: vi.fn(),
    ...(signal ? { signal } : {}),
  };
  const callbacks = asHostType<OAuthLoginCallbacks>(fakeCallbacks, 'OAuthLoginCallbacks', ['onAuth', 'onDeviceCode', 'onPrompt', 'onSelect']);
  return { callbacks, deviceCodes: () => deviceCodes, authUrls: () => authUrls };
}

export interface FakeRefresh {
  readonly ctx: RefreshModelsContext;
  readonly published: () => ModelsPublication[];
}

export interface RefreshOptions {
  allowNetwork?: boolean;
  credential?: Credential;
  stored?: ModelsStoreEntry;
}

/** The context Pi passes to refreshModels, recording what the provider persists. */
export function makeRefresh(options: RefreshOptions = {}): FakeRefresh {
  let published: ModelsPublication[] = [];
  const fakeContext = {
    allowNetwork: options.allowNetwork ?? true,
    signal: new AbortController().signal,
    publish: (publication: ModelsPublication) => {
      published = [...published, publication];
      return Promise.resolve(true);
    },
    ...(options.credential ? { credential: options.credential } : {}),
    ...(options.stored ? { stored: options.stored } : {}),
  };
  const ctx = asHostType<RefreshModelsContext>(fakeContext, 'RefreshModelsContext', ['allowNetwork', 'signal', 'publish']);
  return { ctx, published: () => published };
}

export const oauthCredential = (access: string): OAuthCredentials & { type: 'oauth' } => ({ type: 'oauth', access, refresh: '', expires: 0 });

export const jsonResponse = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
