// Vendored from @earendil-works/pi-ai 1.0.2 src/api/simple-options.ts (MIT) by scripts/vendor-pi-ai.mjs. Import specifiers, reviewed strict-TypeScript adaptations and shared formatting differ. Do not edit.

import type { Api, Model, ModelThinkingLevel, SamplingParams, SimpleStreamOptions, StreamOptions, ThinkingBudgets, ThinkingLevel, TranscriptContext } from '@earendil-works/pi-ai';
import { clampThinkingLevel } from '@earendil-works/pi-ai';
import { estimateContextTokens } from './estimate.ts';

const CONTEXT_SAFETY_TOKENS = 4096;
const MIN_MAX_TOKENS = 1;

export function clampMaxTokensToContext(model: Model<Api>, context: TranscriptContext, maxTokens: number): number {
  if (model.contextWindow <= 0) return Math.max(MIN_MAX_TOKENS, maxTokens);
  const available = model.contextWindow - estimateContextTokens(context).tokens - CONTEXT_SAFETY_TOKENS;
  return Math.min(maxTokens, Math.max(MIN_MAX_TOKENS, available));
}

export function resolveSamplingParams(model: Model<Api>, thinkingLevel: ModelThinkingLevel, requestParams?: SamplingParams): SamplingParams | undefined {
  const effectiveThinkingLevel = clampThinkingLevel(model, thinkingLevel);
  const thinkingLevelParams = model.samplingParamsByThinkingLevel?.[effectiveThinkingLevel];
  return model.samplingParams || thinkingLevelParams || requestParams ? { ...model.samplingParams, ...thinkingLevelParams, ...requestParams } : undefined;
}

export function buildBaseOptions(model: Model<Api>, context: TranscriptContext, options?: SimpleStreamOptions, apiKey?: string): StreamOptions {
  const samplingParams = resolveSamplingParams(model, options?.reasoning ?? 'off', options?.samplingParams);
  const resolvedApiKey = apiKey || options?.apiKey;
  return {
    ...(options?.temperature !== undefined && { temperature: options.temperature }),
    ...(samplingParams !== undefined && { samplingParams }),
    maxTokens: clampMaxTokensToContext(model, context, options?.maxTokens ?? model.maxTokens),
    ...(options?.signal !== undefined && { signal: options.signal }),
    ...(options?.telemetryContext !== undefined && { telemetryContext: options.telemetryContext }),
    ...(resolvedApiKey !== undefined && { apiKey: resolvedApiKey }),
    ...(options?.fetch !== undefined && { fetch: options.fetch }),
    ...(options?.transport !== undefined && { transport: options.transport }),
    ...(options?.cacheRetention !== undefined && { cacheRetention: options.cacheRetention }),
    ...(options?.sessionId !== undefined && { sessionId: options.sessionId }),
    ...(options?.headers !== undefined && { headers: options.headers }),
    ...(options?.onPayload !== undefined && { onPayload: options.onPayload }),
    ...(options?.onResponse !== undefined && { onResponse: options.onResponse }),
    ...(options?.onProviderStreamEvent !== undefined && { onProviderStreamEvent: options.onProviderStreamEvent }),
    ...(options?.timeoutMs !== undefined && { timeoutMs: options.timeoutMs }),
    ...(options?.websocketConnectTimeoutMs !== undefined && { websocketConnectTimeoutMs: options.websocketConnectTimeoutMs }),
    ...(options?.maxRetries !== undefined && { maxRetries: options.maxRetries }),
    ...(options?.maxRetryDelayMs !== undefined && { maxRetryDelayMs: options.maxRetryDelayMs }),
    ...(options?.metadata !== undefined && { metadata: options.metadata }),
    ...(options?.env !== undefined && { env: options.env }),
  };
}

/** Tokens always left for the answer when a thinking budget shares the response ceiling. */
export const MIN_ANSWER_TOKENS = 1024;

export const DEFAULT_THINKING_BUDGETS = {
  minimal: 1024,
  low: 2048,
  medium: 8192,
  high: 16384,
} satisfies ThinkingBudgets;

export function clampReasoning(effort: ThinkingLevel | undefined): Exclude<ThinkingLevel, 'xhigh' | 'max'> | undefined {
  return effort === 'xhigh' || effort === 'max' ? 'high' : effort;
}

export function thinkingBudgetForLevel(reasoningLevel: ThinkingLevel, customBudgets?: ThinkingBudgets): number {
  const budgets = { ...DEFAULT_THINKING_BUDGETS, ...customBudgets };
  const level = reasoningLevel === 'xhigh' || reasoningLevel === 'max' ? 'high' : reasoningLevel;
  return budgets[level];
}

/** Cap a thinking budget so at least MIN_ANSWER_TOKENS remain under a shared response ceiling. */
export function clampThinkingBudgetToAnswerRoom(thinkingBudget: number, ceiling: number): number {
  return Math.min(thinkingBudget, Math.max(0, ceiling - MIN_ANSWER_TOKENS));
}

export function adjustMaxTokensForThinking(
  // Undefined means no explicit caller cap. Use the model cap and fit thinking inside it.
  baseMaxTokens: number | undefined,
  modelMaxTokens: number,
  reasoningLevel: ThinkingLevel,
  customBudgets?: ThinkingBudgets,
): { maxTokens: number; thinkingBudget: number } {
  let thinkingBudget = thinkingBudgetForLevel(reasoningLevel, customBudgets);
  const maxTokens = baseMaxTokens === undefined ? modelMaxTokens : Math.min(baseMaxTokens + thinkingBudget, modelMaxTokens);

  if (maxTokens <= thinkingBudget) {
    thinkingBudget = clampThinkingBudgetToAnswerRoom(thinkingBudget, maxTokens);
  }

  return { maxTokens, thinkingBudget };
}
