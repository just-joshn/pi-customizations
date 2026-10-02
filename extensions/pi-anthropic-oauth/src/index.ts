import { createProvider, type StreamOptions } from '@earendil-works/pi-ai';
import { builtinProviders } from '@earendil-works/pi-ai/providers/all';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

export const PROVIDER_ID = 'claude-subscription';

// Anthropic's subscription gateway attributes a request to the Claude Code plan
// by this first system block. Without it the request is billed against extra
// usage and refused, so the captured string must stay byte-for-byte intact.
const BILLING_BLOCK = {
  type: 'text',
  text: 'x-anthropic-billing-header: cc_version=2.1.280.3a6; cc_entrypoint=sdk-cli;',
};

// Claude Code writes its prompt cache with a one-hour lifetime, and Pi's own
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

function withBillingBlock(payload: unknown): unknown {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) throw unexpectedPayload('an object', payload);
  if (!('system' in payload)) return { ...payload, system: [BILLING_BLOCK] };
  if (!Array.isArray(payload.system)) throw unexpectedPayload('system to be an array or absent', payload.system);
  return { ...payload, system: [BILLING_BLOCK, ...payload.system] };
}

// Pi's Anthropic implementation renames OAuth tools to Claude Code's canonical casing, so
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

function billingOverrides(options: StreamOptions | undefined): Pick<StreamOptions, 'onPayload' | 'cacheRetention'> {
  return {
    cacheRetention: options?.cacheRetention === 'none' ? 'none' : 'long',
    onPayload: async (payload, model) => {
      const billed = withBillingBlock(withUniqueToolNames(payload));
      return (await options?.onPayload?.(billed, model)) ?? billed;
    },
  };
}

export default function (pi: Pick<ExtensionAPI, 'registerProvider'>) {
  const anthropic = builtinProviders().find((provider) => provider.id === 'anthropic');
  const oauth = anthropic?.auth.oauth;
  if (!anthropic || !oauth) throw new Error("Pi's built-in anthropic provider with Claude Pro/Max OAuth is not available.");
  pi.registerProvider(
    createProvider({
      id: PROVIDER_ID,
      name: 'Claude subscription',
      baseUrl: anthropic.baseUrl,
      auth: { oauth: { ...oauth, name: 'Claude subscription (Claude Code)' } },
      models: anthropic.getModels().map((model) => ({ ...model, provider: PROVIDER_ID, promptCache: PROMPT_CACHE })),
      api: {
        stream: (model, context, options) => anthropic.stream(model, context, { ...options, ...billingOverrides(options) }),
        streamSimple: (model, context, options) => anthropic.streamSimple(model, context, { ...options, ...billingOverrides(options) }),
      },
    }),
  );
}
