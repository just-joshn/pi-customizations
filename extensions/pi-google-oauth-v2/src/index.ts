import { hasApi, type Model, type Provider, type RefreshModelsContext } from '@earendil-works/pi-ai';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { createGoogleOAuth } from './auth.ts';
import { API_ID, CODE_ASSIST_BASE_URL, PROVIDER_DISPLAY_NAME, PROVIDER_ID } from './constants.ts';
import { BASELINE_MODELS, createFetchModels } from './models.ts';
import { streamCodeAssist } from './stream.ts';

type CodeAssistModel = Model<typeof API_ID>;

/** Registers the provider only. The factory starts no listener, timer, or request. */
export default function (pi: ExtensionAPI): void {
  let current: readonly CodeAssistModel[] | undefined;
  const fetchModels = createFetchModels();
  const adopt =
    (models: readonly CodeAssistModel[]): (() => void) =>
    () => {
      current = models;
    };
  const restoreStored = async (context: RefreshModelsContext): Promise<boolean> => {
    if (!context.stored) return true;
    const restored = context.stored.models.filter((model): model is CodeAssistModel => model.provider === PROVIDER_ID && hasApi(model, API_ID));
    return context.publish({ update: adopt(restored) });
  };
  const nativeProvider: Provider<typeof API_ID> = {
    id: PROVIDER_ID,
    name: PROVIDER_DISPLAY_NAME,
    baseUrl: CODE_ASSIST_BASE_URL,
    auth: { oauth: createGoogleOAuth() },
    getModels: () => current ?? BASELINE_MODELS,
    refreshModels: async (context) => {
      if (!(await restoreStored(context))) return;
      if (!context.allowNetwork || context.credential?.type !== 'oauth' || context.signal.aborted) return;
      const refreshed = await fetchModels(context);
      if (context.signal.aborted) return;
      await context.publish({ persist: { models: refreshed, checkedAt: Date.now() }, update: adopt(refreshed) });
    },
    stream: streamCodeAssist,
    streamSimple: streamCodeAssist,
  };
  pi.registerProvider(nativeProvider);
}
