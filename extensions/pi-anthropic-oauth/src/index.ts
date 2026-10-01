import { createProvider, type StreamOptions } from '@earendil-works/pi-ai';
import { builtinProviders } from '@earendil-works/pi-ai/providers/all';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

const PROVIDER_ID = 'claude-subscription';

// Dotted digits, 2 to 4 groups. The value becomes the user-agent header, so
// anything looser could smuggle other characters into a request header.
const CLAUDE_CODE_VERSION_PATTERN = /^\d+(?:\.\d+){1,3}$/;

// Anthropic's subscription gateway attributes a request to the Claude Code plan
// by this first system block. Without it the request is billed against extra
// usage and refused, so the captured string must stay byte-for-byte intact.
const BILLING_BLOCK = {
  type: 'text',
  text: 'x-anthropic-billing-header: cc_version=2.1.280.3a6; cc_entrypoint=sdk-cli;',
};

function describeType(value: unknown): string {
  if (value === null) return 'null';
  return Array.isArray(value) ? 'array' : typeof value;
}

function unexpectedPayload(expectation: string, received: unknown): Error {
  return new Error(`Unexpected request payload from Pi's anthropic provider: expected ${expectation}, received ${describeType(received)}.`);
}

function claudeCodeVersion(options: StreamOptions | undefined): string | undefined {
  const version = options?.env?.CLAUDE_CODE_VERSION || process.env.CLAUDE_CODE_VERSION;
  if (!version) return undefined;
  if (!CLAUDE_CODE_VERSION_PATTERN.test(version)) {
    throw new Error(`CLAUDE_CODE_VERSION must be dotted digits with 2 to 4 groups, such as 2.1.280. Received ${JSON.stringify(version)}.`);
  }
  return version;
}

function withBillingBlock(payload: unknown): unknown {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) throw unexpectedPayload('an object', payload);
  if (!('system' in payload)) return { ...payload, system: [BILLING_BLOCK] };
  if (!Array.isArray(payload.system)) throw unexpectedPayload('system to be an array or absent', payload.system);
  return { ...payload, system: [BILLING_BLOCK, ...payload.system] };
}

function billingOverrides(options: StreamOptions | undefined): Pick<StreamOptions, 'headers' | 'onPayload'> {
  const version = claudeCodeVersion(options);
  return {
    headers: version ? { 'user-agent': `claude-cli/${version}`, ...options?.headers } : options?.headers,
    onPayload: async (payload, model) => {
      const billed = withBillingBlock(payload);
      return (await options?.onPayload?.(billed, model)) ?? billed;
    },
  };
}

export default function (pi: ExtensionAPI) {
  const anthropic = builtinProviders().find((provider) => provider.id === 'anthropic');
  const oauth = anthropic?.auth.oauth;
  if (!anthropic || !oauth) throw new Error("Pi's built-in anthropic provider with Claude Pro/Max OAuth is not available.");
  pi.registerProvider(
    createProvider({
      id: PROVIDER_ID,
      name: 'Claude subscription',
      baseUrl: anthropic.baseUrl,
      auth: { oauth: { ...oauth, name: 'Claude subscription (Claude Code)' } },
      models: anthropic.getModels().map((model) => ({ ...model, provider: PROVIDER_ID })),
      api: {
        stream: (model, context, options) => anthropic.stream(model, context, { ...options, ...billingOverrides(options) }),
        streamSimple: (model, context, options) => anthropic.streamSimple(model, context, { ...options, ...billingOverrides(options) }),
      },
    }),
  );
}
