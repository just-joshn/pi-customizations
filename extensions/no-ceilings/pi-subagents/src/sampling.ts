import type { ExtensionFactory } from '@earendil-works/pi-coding-agent';
import type { SubagentSampling } from './types.ts';

const ANTHROPIC_MESSAGES_API = 'anthropic-messages';
const GOOGLE_API_PREFIX = 'google';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function acceptsTopK(api: string): boolean {
  return api === ANTHROPIC_MESSAGES_API || api.startsWith(GOOGLE_API_PREFIX);
}

function withSampling(payload: Record<string, unknown>, api: string, sampling: SubagentSampling): Record<string, unknown> {
  if (api.startsWith(GOOGLE_API_PREFIX)) {
    const generationConfig = payload['generationConfig'];
    const current = isRecord(generationConfig) ? generationConfig : {};
    return {
      ...payload,
      generationConfig: {
        ...current,
        ...(sampling.temperature !== undefined ? { temperature: sampling.temperature } : {}),
        ...(sampling.topP !== undefined ? { topP: sampling.topP } : {}),
        ...(sampling.topK !== undefined ? { topK: sampling.topK } : {}),
      },
    };
  }
  return {
    ...payload,
    ...(sampling.temperature !== undefined ? { temperature: sampling.temperature } : {}),
    ...(sampling.topP !== undefined ? { top_p: sampling.topP } : {}),
    ...(acceptsTopK(api) && sampling.topK !== undefined ? { top_k: sampling.topK } : {}),
  };
}

/** Injects definition sampling into provider requests that ignore `model.samplingParams`. */
export function createSamplingExtension(model: { api: string } | undefined, sampling: SubagentSampling | undefined): ExtensionFactory | undefined {
  if (sampling === undefined) {
    return undefined;
  }
  const api = model?.api ?? '';
  return (pi) => {
    pi.on('before_provider_request', async (event) => {
      if (!isRecord(event.payload)) {
        return event.payload;
      }
      return withSampling(event.payload, api, sampling);
    });
  };
}
