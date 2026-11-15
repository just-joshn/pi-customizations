import { createProvider } from '@earendil-works/pi-ai';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { createGoogleOAuth } from './auth.ts';
import { CODE_ASSIST_BASE_URL, PROVIDER_DISPLAY_NAME, PROVIDER_ID } from './constants.ts';
import { BASELINE_MODELS, createFetchModels } from './models.ts';
import { streamCodeAssist } from './stream.ts';

/** Registers the provider only. The factory starts no listener, timer, or request. */
export default function (pi: ExtensionAPI): void {
  pi.registerProvider(
    createProvider({
      id: PROVIDER_ID,
      name: PROVIDER_DISPLAY_NAME,
      baseUrl: CODE_ASSIST_BASE_URL,
      auth: { oauth: createGoogleOAuth() },
      models: BASELINE_MODELS,
      fetchModels: createFetchModels(),
      api: { stream: streamCodeAssist, streamSimple: streamCodeAssist },
    }),
  );
}
