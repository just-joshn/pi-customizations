import type { ExtensionFactory } from '@earendil-works/pi-coding-agent';
import type { SubagentSampling } from './types.ts';

const ANTHROPIC_MESSAGES_API = 'anthropic-messages';
const BEDROCK_CONVERSE_API = 'bedrock-converse-stream';
const GOOGLE_API_PREFIX = 'google';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function thinkingEnabled(payload: Record<string, unknown>): boolean {
  const thinking = payload['thinking'];
  return isRecord(thinking) && thinking['type'] === 'enabled';
}

function withSampling(payload: Record<string, unknown>, api: string, sampling: SubagentSampling): Record<string, unknown> {
  if (thinkingEnabled(payload)) {
    return payload;
  }
  if (api.startsWith(GOOGLE_API_PREFIX)) {
    const config = payload['config'];
    const current = isRecord(config) ? config : {};
    return {
      ...payload,
      config: {
        ...current,
        ...(sampling.temperature !== undefined ? { temperature: sampling.temperature } : {}),
        ...(sampling.topP !== undefined ? { topP: sampling.topP } : {}),
        ...(sampling.topK !== undefined ? { topK: sampling.topK } : {}),
      },
    };
  }
  if (api === BEDROCK_CONVERSE_API) {
    const inferenceConfig = payload['inferenceConfig'];
    const current = isRecord(inferenceConfig) ? inferenceConfig : {};
    return {
      ...payload,
      inferenceConfig: {
        ...current,
        ...(sampling.temperature !== undefined ? { temperature: sampling.temperature } : {}),
        ...(sampling.topP !== undefined ? { topP: sampling.topP } : {}),
      },
    };
  }
  return {
    ...payload,
    ...(sampling.temperature !== undefined ? { temperature: sampling.temperature } : {}),
    ...(sampling.topP !== undefined ? { top_p: sampling.topP } : {}),
    ...(api === ANTHROPIC_MESSAGES_API && sampling.topK !== undefined ? { top_k: sampling.topK } : {}),
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
