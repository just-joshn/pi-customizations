import { anthropicMessagesApi, type ProviderStreams } from '@earendil-works/pi-ai/compat';
import { createProvider, hasApi } from '@earendil-works/pi-ai/models';
import { builtinProviders } from '@earendil-works/pi-ai/providers/all';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

const ID = 'anthropic-oauth-v2';

type StreamArgs = Parameters<ProviderStreams['stream']>;

const ALLOWED_HEADERS = new Set(['anthropic-beta', 'anthropic-version']);
const isAllowedHeader = ([name, value]: [string, string | null]) => value === null || (ALLOWED_HEADERS.has(name.toLowerCase()) && !value.includes('sk-ant-'));

const assertOAuthOnly = (model: StreamArgs[0], options: StreamArgs[2]) => {
  const headers = Object.entries({ ...model.headers, ...options?.headers });
  const usesOwnClient = options !== undefined && 'client' in options;
  // The Anthropic SDK also reads ANTHROPIC_CUSTOM_HEADERS into every request.
  const setsSdkHeaders = Boolean(process.env['ANTHROPIC_CUSTOM_HEADERS']?.trim());
  if (!options?.apiKey?.startsWith('sk-ant-oat') || usesOwnClient || setsSdkHeaders || !headers.every(isAllowedHeader)) {
    throw new Error(`${ID}: refusing non-OAuth credential; run /login and remove any apiKey and any headers other than anthropic-beta or anthropic-version for ${ID} from models.json, and unset ANTHROPIC_CUSTOM_HEADERS`);
  }
};

export default function (pi: Pick<ExtensionAPI, 'registerProvider'>) {
  const anthropic = builtinProviders().find((provider) => provider.id === 'anthropic');
  const oauth = anthropic?.auth.oauth;
  if (!anthropic || !oauth) throw new Error(`${ID}: this Pi build has no Anthropic OAuth login`);
  const api = anthropicMessagesApi();

  pi.registerProvider(
    createProvider({
      id: ID,
      name: 'Anthropic (Claude subscription)',
      auth: { oauth: { ...oauth, name: 'Anthropic (Claude subscription, OAuth)' } },
      models: anthropic
        .getModels()
        .filter((model) => hasApi(model, 'anthropic-messages'))
        .map((model) => ({ ...model, provider: ID, compat: { supportsMessageThreads: true, ...model.compat } })),
      api: {
        ...api,
        stream: (model, context, options) => {
          assertOAuthOnly(model, options);
          return api.stream(model, context, options);
        },
        streamSimple: (model, context, options) => {
          assertOAuthOnly(model, options);
          return api.streamSimple(model, context, options);
        },
      },
    }),
  );
}
