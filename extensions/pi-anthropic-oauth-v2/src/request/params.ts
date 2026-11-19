import type Anthropic from '@anthropic-ai/sdk';
import { sanitizeSurrogates } from '../messages/content.ts';
import { convertMessages } from '../messages/convert.ts';
import { convertTools } from '../tools/convert.ts';
import { EPHEMERAL_CACHE, REQUEST_CONFIG } from './config.ts';
import { thinkingParams, usesAdaptiveThinking } from './thinking.ts';
import type { StreamRequest } from './types.ts';

type Params = Anthropic.Beta.MessageCreateParamsStreaming;
type OptionalParams = Pick<Params, 'system' | 'tools' | 'betas'>;

const cachedText = (text: string): Anthropic.Beta.BetaTextBlockParam => ({ type: 'text', text, cache_control: EPHEMERAL_CACHE });

function systemParam({ isOAuth, systemPrompt }: StreamRequest): OptionalParams {
  const prompt = systemPrompt ? [cachedText(sanitizeSurrogates(systemPrompt))] : [];
  const system = isOAuth ? [cachedText(REQUEST_CONFIG.claudeCodeIdentity), ...prompt] : prompt;
  return system.length > 0 ? { system } : {};
}

function toolsParam({ tools, isOAuth }: StreamRequest): OptionalParams {
  return tools.length > 0 ? { tools: convertTools(tools, isOAuth) } : {};
}

function betasParam(request: StreamRequest, thinking: boolean): OptionalParams {
  const oauth = request.isOAuth ? REQUEST_CONFIG.oauthBetas : [];
  const interleaved = thinking && !usesAdaptiveThinking(request.model) ? [REQUEST_CONFIG.interleavedThinkingBeta] : [];
  const betas = [...oauth, ...interleaved];
  return betas.length > 0 ? { betas } : {};
}

export function buildParams(request: StreamRequest): Params {
  const { model, options } = request;
  const thinking = thinkingParams(request);
  return {
    model: model.id,
    messages: convertMessages(request.messages, request.isOAuth),
    max_tokens: options?.maxTokens || Math.floor(model.maxTokens / REQUEST_CONFIG.maxTokensDivisor),
    stream: true,
    ...systemParam(request),
    ...toolsParam(request),
    ...thinking,
    ...betasParam(request, thinking.thinking !== undefined),
  };
}
