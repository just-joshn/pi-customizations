import type Anthropic from '@anthropic-ai/sdk';
import type { Api, Model, SimpleStreamOptions } from '@earendil-works/pi-ai';
import { z } from 'zod';
import { REQUEST_CONFIG } from './config.ts';
import type { StreamRequest } from './types.ts';

type ThinkingLevel = NonNullable<SimpleStreamOptions['reasoning']>;
type Effort = NonNullable<Anthropic.Beta.BetaOutputConfig['effort']>;
type ThinkingParams = Pick<Anthropic.Beta.MessageCreateParamsStreaming, 'thinking' | 'output_config'>;

const effortSchema = z.enum(['low', 'medium', 'high', 'xhigh', 'max']);
const adaptiveCompatSchema = z.object({ forceAdaptiveThinking: z.literal(true) });

export const usesAdaptiveThinking = (model: Model<Api>): boolean => adaptiveCompatSchema.safeParse(model.compat).success;

function toEffort(model: Model<Api>, level: ThinkingLevel): Effort {
  const mapped = model.thinkingLevelMap?.[level];
  const effort = effortSchema.safeParse(mapped ?? REQUEST_CONFIG.effortByLevel[level]);
  return effort.success ? effort.data : REQUEST_CONFIG.fallbackEffort;
}

function toBudget(request: StreamRequest, level: ThinkingLevel): number {
  const budgets: Readonly<Record<string, number | undefined>> = { ...REQUEST_CONFIG.thinkingBudgets, ...request.options?.thinkingBudgets };
  return budgets[level] ?? REQUEST_CONFIG.fallbackThinkingBudget;
}

export function thinkingParams(request: StreamRequest): ThinkingParams {
  const level = request.options?.reasoning;
  if (!level || !request.model.reasoning) return {};
  const display = REQUEST_CONFIG.thinkingDisplay;
  if (usesAdaptiveThinking(request.model)) return { thinking: { type: 'adaptive', display }, output_config: { effort: toEffort(request.model, level) } };
  return { thinking: { type: 'enabled', budget_tokens: toBudget(request, level), display } };
}
