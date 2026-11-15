import type { Model } from '@earendil-works/pi-ai';
import { getBuiltinModels } from '@earendil-works/pi-ai/providers/all';
import { API_ID, CODE_ASSIST_BASE_URL, PROVIDER_ID } from './constants.ts';

export const CODE_ASSIST_MODEL_IDS = ['gemini-2.5-pro', 'gemini-3.1-pro-preview', 'gemini-3.5-flash', 'gemini-3.8-flash', 'gemini-3-flash', 'gemini-3.1-flash-lite', 'gemini-3.5-flash-lite'] as const;

const PI_CATALOG_ID: Partial<Record<(typeof CODE_ASSIST_MODEL_IDS)[number], string>> = { 'gemini-3-flash': 'gemini-3-flash-preview' };

export function createCodeAssistModels(): Model<typeof API_ID>[] {
  const catalog = getBuiltinModels('google');
  return CODE_ASSIST_MODEL_IDS.map((id) => {
    const catalogId = PI_CATALOG_ID[id] ?? id;
    const source = catalog.find((model) => model.id === catalogId);
    if (!source) throw new Error(`Pi's Google catalog has no entry for ${catalogId}`);
    return {
      id,
      name: source.name,
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
