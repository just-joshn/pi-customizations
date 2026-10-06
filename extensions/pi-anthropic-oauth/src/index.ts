import { type Api, type AssistantMessage, type AssistantMessageEventStream, createProvider, getDeclaredTools, type Model, type StopReason, type StreamOptions, type TranscriptContext } from '@earendil-works/pi-ai';
import { builtinProviders } from '@earendil-works/pi-ai/providers/all';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { subscriptionAuth } from './auth.ts';
import { type ContextGuard, GUARD_ENTRY_TYPE, installContextGuard } from './context/guard.ts';
import { billingBlock, CLAUDE_USER_AGENT } from './identity.ts';

export const PROVIDER_ID = 'claude-subscription';

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

// Pi's Anthropic implementation renames OAuth tools to Provider CLI's canonical casing, so
// names that differ only in case fold into one and Anthropic rejects the request with
// "Tool names must be unique". Pi's reply maps a tool call back to the first
// case-insensitive match in the session's tools, so the first tool of a folding pair is
// the only one a request can offer. Later duplicates are dropped, and a cache marker on a
// dropped last tool moves to the new last tool so the request keeps its tool breakpoint.
function withUniqueToolNames(payload: unknown): unknown {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return payload;
  if (!('tools' in payload) || !Array.isArray(payload.tools)) return payload;
  // Pi's conversion builds these tools before the hook runs; a tool without a string name
  // fails inside that conversion first.
  const tools = payload.tools as readonly { name: string; cache_control?: unknown }[];
  const seen = new Set<string>();
  const unique: object[] = [];
  let droppedMarker: unknown;
  tools.forEach((tool, index) => {
    const requestTool = tool as { name: string; cache_control?: unknown };
    const folded = requestTool.name.toLowerCase();
    if (!seen.has(folded)) {
      seen.add(folded);
      unique.push(tool);
      return;
    }
    if (index === tools.length - 1) droppedMarker = requestTool.cache_control;
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

function requestOverrides(model: Model<Api>, context: TranscriptContext, options: StreamOptions | undefined, guard: ContextGuard, capture: (payload: unknown) => void): Pick<StreamOptions, 'onPayload' | 'cacheRetention' | 'headers'> {
  const block = billingBlock(context);
  const configuredHeaders = new Set([model.headers, options?.headers].flatMap((headers) => Object.keys(headers ?? {}).map((name) => name.toLowerCase())));
  const defaults = { 'user-agent': CLAUDE_USER_AGENT, ...(options?.sessionId ? { 'x-claude-code-session-id': options.sessionId } : {}) };
  const headers = Object.fromEntries(Object.entries(defaults).filter(([name]) => !configuredHeaders.has(name)));
  return {
    headers: { ...headers, ...options?.headers },
    cacheRetention: options?.cacheRetention === 'none' ? 'none' : 'long',
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

// Only a successful terminal response carries a usable context measurement.
// Error and aborted attempts must not feed the bias, and a deferred handle is
// not terminal yet.
const SUCCESSFUL_STOP_REASONS: ReadonlySet<StopReason> = new Set(['stop', 'toolUse', 'length']);

/** The context tokens the endpoint counted for a request, or undefined. */
function observedContextTokens(message: AssistantMessage): number | undefined {
  if (!SUCCESSFUL_STOP_REASONS.has(message.stopReason)) return undefined;
  const usage = message.usage;
  // The context is the input side. `totalTokens` also counts the output and is
  // only used when an adapter reports no input breakdown.
  const input = usage.input + usage.cacheRead + usage.cacheWrite;
  const tokens = input > 0 ? input : usage.totalTokens;
  return tokens > 0 ? tokens : undefined;
}

// Observes the final assistant usage against the exact payload that produced
// it. `result()` is an independent promise, so the caller still reads every
// event from the same stream and this never blocks the synchronous return.
function guardedStream<TOptions extends StreamOptions>(
  streamFn: (model: Model<Api>, context: TranscriptContext, options?: TOptions) => AssistantMessageEventStream,
  model: Model<Api>,
  context: TranscriptContext,
  options: TOptions | undefined,
  guard: ContextGuard,
): AssistantMessageEventStream {
  let observed: unknown;
  const streamed = streamFn(
    modelForCaseCollisions(model, context),
    context,
    Object.assign(
      {},
      options,
      requestOverrides(model, context, options, guard, (payload) => {
        observed = payload;
      }),
    ),
  );
  void streamed.result().then(
    (message) => {
      try {
        const tokens = observedContextTokens(message);
        if (tokens === undefined) return;
        guard.observe(observed, tokens);
      } catch {
        // Usage observation must not surface as an unhandled rejection.
        return;
      }
    },
    () => undefined,
  );
  return streamed;
}

/** The extension API methods this package uses, straight from Pi's own type. */
export type ExtensionHost = Pick<ExtensionAPI, 'registerProvider' | 'on' | 'appendEntry' | 'getAllTools' | 'getActiveTools' | 'getSettings'>;

export default function (pi: ExtensionHost) {
  const anthropic = builtinProviders().find((provider) => provider.id === 'anthropic');
  const oauth = anthropic?.auth.oauth;
  if (!anthropic || !oauth) throw new Error("Pi's built-in anthropic provider with Claude Pro/Max OAuth is not available.");
  const guard = installContextGuard(pi, {
    providerId: PROVIDER_ID,
    notify: (message) => pi.appendEntry(GUARD_ENTRY_TYPE, { message }),
  });
  pi.registerProvider(
    createProvider({
      id: PROVIDER_ID,
      name: 'Claude subscription',
      ...(anthropic.baseUrl === undefined ? {} : { baseUrl: anthropic.baseUrl }),
      auth: subscriptionAuth(oauth),
      models: anthropic.getModels().map((model) => ({ ...model, provider: PROVIDER_ID, promptCache: PROMPT_CACHE })),
      api: {
        stream: (model, context, options) => guardedStream(anthropic.stream, model, context, options, guard),
        streamSimple: (model, context, options) => guardedStream(anthropic.streamSimple, model, context, options, guard),
      },
    }),
  );
}
