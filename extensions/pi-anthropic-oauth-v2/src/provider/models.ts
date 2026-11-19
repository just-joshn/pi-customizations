import { type Api, hasApi, type Model } from '@earendil-works/pi-ai';
import { builtinProviders } from '@earendil-works/pi-ai/providers/all';
import type { ProviderModelConfig } from '@earendil-works/pi-coding-agent';
import { PROVIDER_CONFIG } from './config.ts';

function toModelConfig(model: Model<'anthropic-messages'>): ProviderModelConfig {
  const forceAdaptiveThinking = model.compat?.forceAdaptiveThinking;
  return {
    id: model.id,
    name: `${model.name}${PROVIDER_CONFIG.modelNameSuffix}`,
    reasoning: model.reasoning,
    input: [...model.input],
    cost: model.cost,
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
    ...(model.thinkingLevelMap ? { thinkingLevelMap: model.thinkingLevelMap } : {}),
    ...(forceAdaptiveThinking === undefined ? {} : { compat: { forceAdaptiveThinking } }),
  };
}

const isMessagesModel = (model: Model<Api>): model is Model<'anthropic-messages'> => hasApi(model, PROVIDER_CONFIG.catalogApi);

export function loadAnthropicModels(): ProviderModelConfig[] {
  const catalog = builtinProviders().find((provider) => provider.id === PROVIDER_CONFIG.catalogProviderId);
  if (!catalog) {
    console.error('Pi has no built-in Anthropic model catalog.');
    throw new Error('This Pi build has no Anthropic model catalog, so custom-anthropic has no models to offer.');
  }
  return catalog.getModels().filter(isMessagesModel).map(toModelConfig);
}
