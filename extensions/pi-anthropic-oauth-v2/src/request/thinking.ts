import type Anthropic from '@anthropic-ai/sdk';
import type { Api, Model, SimpleStreamOptions, ThinkingBudgets } from '@earendil-works/pi-ai';
import { z } from 'zod';
import { REQUEST_CONFIG } from './config.ts';
import type { StreamRequest } from './types.ts';

type ThinkingLevel = NonNullable<SimpleStreamOptions['reasoning']>;
type BudgetLevel = keyof ThinkingBudgets;
type ThinkingParams = Pick<Anthropic.Beta.MessageCreateParamsStreaming, 'thinking' | 'output_config'>;

const effortSchema = z.enum(['low', 'medium', 'high', 'xhigh', 'max']).catch(REQUEST_CONFIG.fallbackEffort);

const defaultBudgets: ThinkingBudgets = REQUEST_CONFIG.thinkingBudgets;
const effortByLevel: Readonly<Partial<Record<ThinkingLevel, string>>> = REQUEST_CONFIG.effortByLevel;

const hasBudget = (level: ThinkingLevel): level is BudgetLevel => level in defaultBudgets;

/** Pi's catalog marks the models that only accept adaptive thinking with `compat.forceAdaptiveThinking`. */
export const usesAdaptiveThinking = ({ compat }: Model<Api>): boolean => compat !== undefined && 'forceAdaptiveThinking' in compat && compat.forceAdaptiveThinking === true;

const toEffort = (model: Model<Api>, level: ThinkingLevel) => effortSchema.parse(model.thinkingLevelMap?.[level] ?? effortByLevel[level]);

function toBudget(request: StreamRequest, level: ThinkingLevel): number {
  const budgets: ThinkingBudgets = { ...defaultBudgets, ...request.options?.thinkingBudgets };
  return (hasBudget(level) ? budgets[level] : undefined) ?? REQUEST_CONFIG.fallbackThinkingBudget;
}

export function thinkingParams(request: StreamRequest): ThinkingParams {
  const level = request.options?.reasoning;
  if (!level || !request.model.reasoning) return {};
  const display = REQUEST_CONFIG.thinkingDisplay;
  if (usesAdaptiveThinking(request.model)) return { thinking: { type: 'adaptive', display }, output_config: { effort: toEffort(request.model, level) } };
  return { thinking: { type: 'enabled', budget_tokens: toBudget(request, level), display } };
}
