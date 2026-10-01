import { clampThinkingLevel, getSupportedThinkingLevels, type ModelThinkingLevel } from '@earendil-works/pi-ai';
import type { resolveModel } from '../models.ts';

type Selection = ReturnType<typeof resolveModel>;
const levels = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
const budgetLevels = [
  [0, 'off'],
  [1024, 'minimal'],
  [2048, 'low'],
  [8192, 'medium'],
  [16384, 'high'],
] as const;

function levelForBudget(tokens: number): ModelThinkingLevel {
  return budgetLevels.find(([ceiling]) => tokens <= ceiling)?.[1] ?? 'xhigh';
}

export function withAgentEffort(selected: Selection, effort: string | number | undefined, env: NodeJS.ProcessEnv = process.env, settings: object = {}): Selection {
  if (!selected.model.reasoning) return selected;
  const configured = (env.PI_EFFORT_LEVEL ?? env.CLAUDE_CODE_EFFORT_LEVEL)?.trim().toLowerCase();
  const setting = 'effortLevel' in settings && typeof settings.effortLevel === 'string' ? settings.effortLevel : undefined;
  const raw = configured || (effort ?? setting);
  const requested = levels.find((level) => level === raw);
  const supported = getSupportedThinkingLevels(selected.model);
  const named = requested === 'max' ? (supported.at(-1) ?? 'off') : (requested ?? selected.thinkingLevel);
  const level = typeof raw === 'number' ? levelForBudget(raw) : named;
  const maximum = 'maxEffortLevel' in settings ? levels.find((candidate) => candidate === settings.maxEffortLevel) : undefined;
  const effective = clampThinkingLevel(selected.model, level);
  const cap = maximum ? clampThinkingLevel(selected.model, maximum === 'max' ? (supported.at(-1) ?? 'off') : maximum) : undefined;
  return { ...selected, thinkingLevel: cap && supported.indexOf(effective) > supported.indexOf(cap) ? cap : effective };
}
