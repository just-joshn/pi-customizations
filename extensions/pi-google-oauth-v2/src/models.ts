import type { Model } from '@earendil-works/pi-ai';
import { getBuiltinModels } from '@earendil-works/pi-ai/providers/all';
import { API_ID, CODE_ASSIST_BASE_URL, PROVIDER_ID } from './constants.ts';

export const CODE_ASSIST_MODEL_IDS = ['gemini-4-argon', 'gemini-3.8-flash'] as const;

const STAND_IN_CATALOG_ID = 'gemini-3.1-pro-preview';

export function createCodeAssistModels(catalog: readonly Model<string>[] = getBuiltinModels('google')): Model<typeof API_ID>[] {
  return CODE_ASSIST_MODEL_IDS.map((id) => {
    const exact = catalog.find((model) => model.id === id);
    const source = exact ?? catalog.find((model) => model.id === STAND_IN_CATALOG_ID);
    if (!source) throw new Error(`Pi's Google catalog has neither ${id} nor ${STAND_IN_CATALOG_ID}`);
    return {
      id,
      name: exact ? source.name : `${id} (limits unverified)`,
      api: API_ID,
      provider: PROVIDER_ID,
      baseUrl: CODE_ASSIST_BASE_URL,
      input: source.input,
      ...(source.inputLimits === undefined ? {} : { inputLimits: source.inputLimits }),
      cost: source.cost,
      reasoning: source.reasoning,
      contextWindow: source.contextWindow,
      maxTokens: source.maxTokens,
      ...(source.thinkingLevelMap === undefined ? {} : { thinkingLevelMap: source.thinkingLevelMap }),
    };
  });
}
