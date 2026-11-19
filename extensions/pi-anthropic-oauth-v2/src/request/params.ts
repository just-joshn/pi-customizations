import type { MessageCreateParamsStreaming, TextBlockParam } from '@anthropic-ai/sdk/resources/messages.js';
import { sanitizeSurrogates } from '../messages/content.ts';
import { convertMessages } from '../messages/convert.ts';
import { convertTools } from '../tools/convert.ts';
import { EPHEMERAL_CACHE, REQUEST_CONFIG } from './config.ts';
import type { StreamRequest } from './types.ts';

type OptionalParams = Pick<MessageCreateParamsStreaming, 'system' | 'tools' | 'thinking'>;

const cachedText = (text: string): TextBlockParam => ({ type: 'text', text, cache_control: EPHEMERAL_CACHE });

function systemParam({ isOAuth, systemPrompt }: StreamRequest): OptionalParams {
  const prompt = systemPrompt ? [cachedText(sanitizeSurrogates(systemPrompt))] : [];
  const system = isOAuth ? [cachedText(REQUEST_CONFIG.claudeCodeIdentity), ...prompt] : prompt;
  return system.length > 0 ? { system } : {};
}

function toolsParam({ tools, isOAuth }: StreamRequest): OptionalParams {
  return tools.length > 0 ? { tools: convertTools(tools, isOAuth) } : {};
}

function thinkingParam({ model, options }: StreamRequest): OptionalParams {
  if (!options?.reasoning || !model.reasoning) return {};
  const budgets: Readonly<Record<string, number | undefined>> = { ...REQUEST_CONFIG.thinkingBudgets, ...options.thinkingBudgets };
  return { thinking: { type: 'enabled', budget_tokens: budgets[options.reasoning] ?? REQUEST_CONFIG.fallbackThinkingBudget } };
}

export function buildParams(request: StreamRequest): MessageCreateParamsStreaming {
  const { model, options } = request;
  return {
    model: model.id,
    messages: convertMessages(request.messages, request.isOAuth),
    max_tokens: options?.maxTokens || Math.floor(model.maxTokens / REQUEST_CONFIG.maxTokensDivisor),
    stream: true,
    ...systemParam(request),
    ...toolsParam(request),
    ...thinkingParam(request),
  };
}
