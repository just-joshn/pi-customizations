import { join } from 'node:path';

import { type Api, type AssistantMessage, type AssistantMessageEventStream, type CredentialStore, createProvider, getDeclaredTools, type Model, type StopReason, type StreamOptions, type TranscriptContext } from '@earendil-works/pi-ai';
import { builtinProviders } from '@earendil-works/pi-ai/providers/all';
import { type ExtensionAPI, getAgentDir } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { Check } from 'typebox/value';
import { attestingFetch } from './attesting-fetch.ts';
import { createClaudeOAuth, subscriptionAuth } from './auth.ts';
import { type AuthRecovery, createAuthRecovery } from './auth-recovery.ts';
import { type ContextGuard, GUARD_ENTRY_TYPE, installContextGuard } from './context/guard.ts';
import { billingBlock, CLAUDE_USER_AGENT } from './identity.ts';
import { latestRecorded, refreshClaimDirectoryFor } from './refresh-claim.ts';
import { attributionFor } from './request-session.ts';
import { storedIn } from './stored-credential.ts';

export const PROVIDER_ID = 'claude-subscription';

function defaultAuthJsonPath(): string {
  return join(getAgentDir(), 'auth.json');
}

/** What the host binds after loading the extension. The latest loaded provider reads it. */
const host: { authPath: string | undefined; bindCredentials: (store: CredentialStore) => void } = { authPath: undefined, bindCredentials: () => undefined };

/** Bind the CredentialStore Models uses so 401 recovery persists rotated tokens. */
export function bindSubscriptionCredentials(store: CredentialStore): void {
  host.bindCredentials(store);
}

/**
 * Bind the auth.json path whose directory holds the cross-process rotation log.
 * Every refresh, Pi's expiry refresh and 401 recovery alike, claims the refresh token in
 * `claude-subscription-refresh.claims` in that directory and records its successor there.
 * A caller holding a rotated token gets the recorded successor instead of resending the token.
 * Omit the argument to use `<agentDir>/auth.json`. Pass `undefined` to refresh without the log.
 */
export function bindSubscriptionRefreshLock(...args: [] | [authJsonPath: string | undefined]): void {
  host.authPath = args.length === 0 ? defaultAuthJsonPath() : args[0];
}

// Provider CLI writes its prompt cache with a one-hour lifetime, and Pi's own
// default is five minutes. The models declare the lifetime the request really
// gets, so Pi's cache warmer does not refresh an entry that is still alive.
const CACHE_LIFETIME_SECONDS = 3600;
const PROMPT_CACHE = { short: CACHE_LIFETIME_SECONDS, long: CACHE_LIFETIME_SECONDS };

function describeType(value: unknown): string {
  if (value === null) return 'null';
  return Array.isArray(value) ? 'array' : typeof value;
}

function unexpectedPayload(expectation: string, received: unknown): Error {
  return new Error(`Unexpected request payload from Pi's anthropic provider: expected ${expectation}, received ${describeType(received)}.`);
}

function withBillingBlock(payload: unknown, block: ReturnType<typeof billingBlock>): unknown {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) throw unexpectedPayload('an object', payload);
  if (!('system' in payload)) return { ...payload, system: [block] };
  if (!Array.isArray(payload.system)) throw unexpectedPayload('system to be an array or absent', payload.system);
  const system = payload.system.filter(
    (entry: unknown) => !(typeof entry === 'object' && entry !== null && 'type' in entry && entry.type === 'text' && 'text' in entry && typeof entry.text === 'string' && entry.text.startsWith('x-anthropic-billing-header:')),
  );
  return { ...payload, system: [block, ...system] };
}

const RequestTools = Type.Array(Type.Object({ name: Type.String() }));

// Pi's Anthropic implementation renames OAuth tools to Provider CLI's canonical casing, so
// names that differ only in case fold into one and Anthropic rejects the request with
// "Tool names must be unique". Pi's reply maps a tool call back to the first
// case-insensitive match in the session's tools, so the first tool of a folding pair is
// the only one a request can offer.
function withUniqueToolNames(payload: unknown): unknown {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return payload;
  if (!('tools' in payload) || !Check(RequestTools, payload.tools)) return payload;
  const tools = payload.tools;
  const seen = new Set<string>();
  const unique: object[] = [];
  let droppedMarker: unknown;
  tools.forEach((tool, index) => {
    const folded = tool.name.toLowerCase();
    if (!seen.has(folded)) {
      seen.add(folded);
      unique.push(tool);
      return;
    }
    if (index === tools.length - 1 && 'cache_control' in tool) droppedMarker = tool.cache_control;
  });
  if (unique.length === tools.length) return payload;
  if (droppedMarker !== undefined && unique.length > 0) {
    const last = unique.length - 1;
    unique[last] = { ...unique[last], cache_control: droppedMarker };
  }
  return { ...payload, tools: unique };
}

function modelForCaseCollisions(model: Model<Api>, context: TranscriptContext): Model<Api> {
  const compat = { supportsMidConvoSystemMessages: false, supportsMidConvoToolChanges: false, ...model.compat };
  if (!compat.supportsMidConvoToolChanges || !compat.supportsMidConvoSystemMessages) return model;
  const names = getDeclaredTools(context.messages).map((tool) => tool.name.toLowerCase());
  if (new Set(names).size === names.length) return model;
  return { ...model, compat: { ...model.compat, supportsMidConvoToolChanges: false } };
}

function requestOverrides({
  model,
  context,
  options,
  guard,
  capture,
  recovery,
}: {
  model: Model<Api>;
  context: TranscriptContext;
  options: StreamOptions | undefined;
  guard: ContextGuard;
  capture: (payload: unknown) => void;
  recovery: AuthRecovery;
}): Pick<StreamOptions, 'onPayload' | 'cacheRetention' | 'headers' | 'fetch'> {
  const attribution = attributionFor(options?.sessionId, context);
  const block = billingBlock(context, attribution);
  const configuredHeaders = new Set([model.headers, options?.headers].flatMap((headers) => Object.keys(headers ?? {}).map((name) => name.toLowerCase())));
  const defaults = {
    'user-agent': CLAUDE_USER_AGENT,
    'x-claude-code-prompt-id': attribution.promptId,
    'x-claude-code-request-class': 'main',
    ...(options?.sessionId ? { 'x-claude-code-session-id': options.sessionId } : {}),
  };
  const headers = Object.fromEntries(Object.entries(defaults).filter(([name]) => !configuredHeaders.has(name)));
  const baseFetch = options?.fetch ?? globalThis.fetch;
  return {
    headers: { ...headers, ...options?.headers },
    cacheRetention: options?.cacheRetention === 'none' ? 'none' : 'long',
    fetch: recovery.wrapFetch(attestingFetch(baseFetch.bind(globalThis), options?.sessionId)),
    onPayload: async (payload, delegatedModel) => {
      capture(undefined);
      const fitted = guard.fit(withUniqueToolNames(payload), model);
      const billed = withBillingBlock(fitted, block);
      const sent = (await options?.onPayload?.(billed, delegatedModel)) ?? billed;
      capture(sent);
      return sent;
    },
  };
}

const SUCCESSFUL_STOP_REASONS: ReadonlySet<StopReason> = new Set(['stop', 'toolUse', 'length']);

function observedContextTokens(message: AssistantMessage): number | undefined {
  if (!SUCCESSFUL_STOP_REASONS.has(message.stopReason)) return undefined;
  const usage = message.usage;
  const input = usage.input + usage.cacheRead + usage.cacheWrite;
  const tokens = input > 0 ? input : usage.totalTokens;
  return tokens > 0 ? tokens : undefined;
}

function guardedStream<TOptions extends StreamOptions>({
  streamFn,
  model,
  context,
  options,
  guard,
  recovery,
}: {
  streamFn: (model: Model<Api>, context: TranscriptContext, options?: TOptions) => AssistantMessageEventStream;
  model: Model<Api>;
  context: TranscriptContext;
  options: TOptions | undefined;
  guard: ContextGuard;
  recovery: AuthRecovery;
}): AssistantMessageEventStream {
  let observed: unknown;
  const capture = (payload: unknown): void => {
    observed = payload;
  };
  const streamed = streamFn(modelForCaseCollisions(model, context), context, Object.assign({}, options, requestOverrides({ model, context, options, guard, capture, recovery })));
  void streamed.result().then(
    (message) => {
      try {
        const tokens = observedContextTokens(message);
        if (tokens === undefined) return;
        guard.observe(observed, tokens);
      } catch {
        return;
      }
    },
    () => undefined,
  );
  return streamed;
}

export type ExtensionHost = Pick<ExtensionAPI, 'registerProvider' | 'on' | 'appendEntry' | 'getAllTools' | 'getActiveTools' | 'getSettings'>;

export default function (pi: ExtensionHost) {
  const anthropic = builtinProviders().find((provider) => provider.id === 'anthropic');
  if (!anthropic) throw new Error("Pi's built-in anthropic provider is not available.");
  const oauth = createClaudeOAuth();
  host.authPath = defaultAuthJsonPath();
  const directory = () => (host.authPath === undefined ? undefined : refreshClaimDirectoryFor(host.authPath));
  const stored = () => storedIn(PROVIDER_ID, host.authPath);
  // Recovery refreshes through auth, and auth reports every credential back to recovery.
  let recovery: AuthRecovery | undefined;
  const auth = subscriptionAuth(oauth, {
    onCredential: (credential, rotation) => recovery?.remember(credential, rotation),
    onNoStoredCredential: () => recovery?.forget(),
    rotation: { directory, stored },
  });
  recovery = createAuthRecovery({ providerId: PROVIDER_ID, oauth: auth.oauth, recorded: (credential) => latestRecorded(directory(), credential), stored });
  host.bindCredentials = recovery.bindCredentials;
  const guard = installContextGuard(pi, {
    providerId: PROVIDER_ID,
    notify: (message) => pi.appendEntry(GUARD_ENTRY_TYPE, { message }),
  });
  pi.registerProvider(
    createProvider({
      id: PROVIDER_ID,
      name: 'Claude subscription',
      ...(anthropic.baseUrl === undefined ? {} : { baseUrl: anthropic.baseUrl }),
      auth,
      models: anthropic.getModels().map((model) => ({ ...model, provider: PROVIDER_ID, promptCache: PROMPT_CACHE })),
      api: {
        stream: (model, context, options) => guardedStream({ streamFn: anthropic.stream, model, context, options, guard, recovery }),
        streamSimple: (model, context, options) => guardedStream({ streamFn: anthropic.streamSimple, model, context, options, guard, recovery }),
      },
    }),
  );
}
