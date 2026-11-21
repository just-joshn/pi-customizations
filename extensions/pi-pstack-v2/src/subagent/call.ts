import type { ThinkingLevel } from '@earendil-works/pi-agent-core';
import type { AgentConfig } from './agents.ts';
import { isForkAgent } from './fork.ts';
import type { ParsedSubagentParams, WorkItem } from './schema.ts';
import type { DispatchDefaults, SubagentMode } from './types.ts';

/** What a call asks for: the one mode it names and the workers that mode runs, in order. */
export interface NormalizedCall {
  mode: SubagentMode;
  items: WorkItem[];
}

/** The mode and items of a call, or undefined when it names none or several. */
export function normalizeCall(params: ParsedSubagentParams): NormalizedCall | undefined {
  const { agent, task } = params;
  const single: WorkItem[] = agent && task ? [{ agent, task, cwd: params.cwd, model: params.model, thinking: params.thinking, isolation: params.isolation }] : [];
  const named: NormalizedCall[] = [
    { mode: 'chain', items: params.chain ?? [] },
    { mode: 'parallel', items: params.tasks ?? [] },
    { mode: 'single', items: single },
  ];
  const present = named.filter((call) => call.items.length > 0);
  const [only] = present;
  return present.length === 1 ? only : undefined;
}

export interface ModelChoice {
  model: string | undefined;
  thinking: ThinkingLevel | undefined;
}

/**
 * The model and thinking level one worker runs at. A model named by the call or the agent runs at its own default thinking
 * level unless the call names one. A fork names neither: it keeps the parent's model, thinking level and system prompt so
 * its prompt prefix matches the parent's cache.
 */
export function resolveModelChoice(agent: AgentConfig, call: Pick<WorkItem, 'model' | 'thinking'>, defaults: DispatchDefaults): ModelChoice {
  if (isForkAgent(agent)) return { model: defaults.model, thinking: defaults.thinkingLevel };
  const named = call.model ?? agent.model;
  return { model: named ?? defaults.model, thinking: call.thinking ?? (named ? undefined : defaults.thinkingLevel) };
}
