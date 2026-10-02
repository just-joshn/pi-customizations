import { createProvider, getSupportedThinkingLevels, type Provider, type RefreshModelsContext } from '@earendil-works/pi-ai';
import { builtinProviders } from '@earendil-works/pi-ai/providers/all';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { BASELINE, catalogFailure, type EffortAlias, effortAliases, listPrices, PROVIDER_ID, PROXY_BASE_URL, parseCatalog, toPiModel } from './catalog.ts';
import { withGrokHeaders } from './request.ts';

const XAI_MISSING = "Pi's built-in xai provider with SuperGrok / X Premium OAuth is not available.";
const NOT_LOGGED_IN = 'Grok Build is not logged in. Run /login and choose Grok Build.';

export function createGrokBuildProvider(xai: Provider): Provider {
  const oauth = xai.auth.oauth;
  if (!oauth) throw new Error(XAI_MISSING);
  const prices = listPrices(xai.getModels());

  const fetchModels = async (context: RefreshModelsContext) => {
    if (context.credential?.type !== 'oauth') throw new Error(NOT_LOGGED_IN);
    const { apiKey } = await oauth.toAuth(context.credential);
    if (!apiKey) throw new Error(NOT_LOGGED_IN);
    const response = await fetch(`${PROXY_BASE_URL}/models`, { headers: { Authorization: `Bearer ${apiKey}` }, signal: context.signal });
    if (!response.ok) throw catalogFailure(response.status);
    const parsed = parseCatalog(await response.json().catch(() => undefined));
    if (parsed.kind === 'unreadable') throw new Error('Grok Build returned a model list Pi cannot read.');
    return parsed.models.map((model) => toPiModel(model, prices));
  };

  return createProvider({
    id: PROVIDER_ID,
    name: 'Grok Build',
    baseUrl: PROXY_BASE_URL,
    auth: { oauth: { ...oauth, name: 'Grok Build (SuperGrok or X Premium)' } },
    models: BASELINE.map((model) => toPiModel(model, prices)),
    fetchModels,
    api: withGrokHeaders(xai),
  });
}

type RouteContext = Parameters<Parameters<ExtensionAPI['registerVirtualModel']>[0]['route']>[1];

function routeAlias({ target, effort }: EffortAlias, ctx: RouteContext) {
  const model = ctx.modelRegistry.find(PROVIDER_ID, target);
  if (!model) throw new Error(`Grok Build no longer lists ${target}.`);
  const supported = getSupportedThinkingLevels(model);
  if (!supported.includes(effort)) throw new Error(`${target} no longer offers ${effort} reasoning. Supported: ${supported.join(', ')}.`);
  return { model, thinkingLevel: effort };
}

export default function (pi: Pick<ExtensionAPI, 'registerProvider' | 'registerVirtualModel'>) {
  const xai = builtinProviders().find((provider) => provider.id === 'xai');
  if (!xai) throw new Error(XAI_MISSING);
  pi.registerProvider(createGrokBuildProvider(xai));
  for (const alias of effortAliases(BASELINE)) {
    pi.registerVirtualModel({
      provider: PROVIDER_ID,
      id: alias.id,
      name: alias.name,
      thinkingLevels: [alias.effort],
      contextWindow: alias.contextWindow,
      maxTokens: alias.contextWindow,
      route: (_request, ctx) => routeAlias(alias, ctx),
    });
  }
}
