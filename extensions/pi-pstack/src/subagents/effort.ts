import { clampThinkingLevel, getSupportedThinkingLevels } from '@earendil-works/pi-ai';
import type { resolveModel } from '../models.ts';

type Selection = ReturnType<typeof resolveModel>;
const levels = ['low', 'medium', 'high', 'xhigh', 'max'] as const;

export function withAgentEffort(selected: Selection, effort: string | number | undefined, env: NodeJS.ProcessEnv = process.env, settings: object = {}): Selection {
  if (!selected.model.reasoning) return selected;
  const configured = (env.PI_EFFORT_LEVEL ?? env.CLAUDE_CODE_EFFORT_LEVEL)?.trim().toLowerCase();
  const setting = 'effortLevel' in settings && typeof settings.effortLevel === 'string' ? settings.effortLevel : undefined;
  const raw = configured || (effort ?? setting);
  if (typeof raw === 'number') throw new Error(`Cannot apply integer agent effort ${raw}: Pi exposes named thinking levels, not an integer effort budget.`);
  const requested = levels.find((level) => level === raw);
  const supported = getSupportedThinkingLevels(selected.model);
  const level = requested === 'max' ? (supported.at(-1) ?? 'off') : (requested ?? selected.thinkingLevel);
  const maximum = 'maxEffortLevel' in settings ? levels.find((candidate) => candidate === settings.maxEffortLevel) : undefined;
  const effective = clampThinkingLevel(selected.model, level);
  const cap = maximum ? clampThinkingLevel(selected.model, maximum === 'max' ? (supported.at(-1) ?? 'off') : maximum) : undefined;
  return { ...selected, thinkingLevel: cap && supported.indexOf(effective) > supported.indexOf(cap) ? cap : effective };
}
