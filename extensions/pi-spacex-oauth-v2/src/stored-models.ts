import { type AnyModel, type Api, isModelType, type Model, type ModelsStoreEntry, type ThinkingLevelMap } from '@earendil-works/pi-ai';
import type { ProviderModelConfig } from '@earendil-works/pi-coding-agent';

/** The chat entries of a provider model list, which is all this extension publishes. */
export type ChatModelConfig = Extract<ProviderModelConfig, { reasoning: boolean }>;

const MAX_OUTPUT_TOKENS = 64_000;

/** What differs between this extension's chat models; `levels` is undefined for a model with no thinking controls. */
export interface ChatModelSpec {
  id: string;
  name: string;
  contextWindow: number;
  levels: ThinkingLevelMap | undefined;
}

/** A subscription chat model: free to call, text and image input, and a thinking map only when it can think. */
export const chatModel = ({ id, name, contextWindow, levels }: ChatModelSpec): ChatModelConfig => ({
  id,
  name,
  reasoning: levels !== undefined,
  ...(levels ? { thinkingLevelMap: levels } : {}),
  input: ['text', 'image'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow,
  maxTokens: MAX_OUTPUT_TOKENS,
});

/** Where a provider's models are served, merged into each persisted entry. */
export interface ModelTarget {
  provider: string;
  api: Api;
  baseUrl: string;
}

const onlyChatModels = (models: readonly AnyModel[]): models is Model<Api>[] => models.every((model) => isModelType(model, 'chat'));

/** The models persisted by an earlier live refresh, or undefined when nothing chat-only was stored. */
export function readStoredModels(stored: Readonly<ModelsStoreEntry> | undefined): ChatModelConfig[] | undefined {
  const models = stored?.models;
  return models && onlyChatModels(models) ? models : undefined;
}

/** The persisted catalog form of live models: each config plus the target it is served from. */
export function toStoredModels(target: ModelTarget, models: readonly ChatModelConfig[]): AnyModel[] {
  return models.map((model) => toStoredModel(target, model));
}

/** Keeps a config's optional fields only when they are set, so the stored model never holds an explicit undefined. */
function toStoredModel(target: ModelTarget, model: ChatModelConfig): Model<Api> {
  const { api, baseUrl, thinkingLevelMap, promptCache, compat, inputLimits, ...rest } = model;
  return {
    ...target,
    ...rest,
    api: api ?? target.api,
    baseUrl: baseUrl ?? target.baseUrl,
    ...(thinkingLevelMap ? { thinkingLevelMap } : {}),
    ...(promptCache ? { promptCache } : {}),
    ...(compat ? { compat } : {}),
    ...(inputLimits ? { inputLimits } : {}),
  };
}
