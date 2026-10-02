import { availableParallelism } from 'node:os';

import { SubagentLimiter } from './limiter.ts';
import { type Reference AssistantSettings, defaultMaxConcurrency, defaultMaxDepth } from './settings.ts';
import type { SettingsStore } from './settings-store.ts';
import { currentScope } from './subagent-context.ts';

export function limiterConfig(settings: Reference AssistantSettings, parallelism: number): { maxConcurrent: number; maxDepth: number } {
  return { maxConcurrent: settings.subagents.maxConcurrency ?? defaultMaxConcurrency(parallelism), maxDepth: settings.subagents.maxDepth ?? defaultMaxDepth };
}

/**
 * One limiter per root session, configured once from the settings in force at the first use. A child session never
 * configures one: it reaches the root's through the async scope, so nested spawns count against the same slots.
 */
export class LimiterProvider {
  private root: SubagentLimiter | undefined;

  constructor(
    private readonly settings: SettingsStore,
    private readonly parallelism: () => number = availableParallelism,
  ) {}

  get(cwd: string): SubagentLimiter {
    const inherited = currentScope()?.limiter;
    if (inherited) return inherited;
    this.root ??= new SubagentLimiter(limiterConfig(this.settings.read(cwd).settings, this.parallelism()));
    return this.root;
  }

  reset(): void {
    this.root = undefined;
  }
}
