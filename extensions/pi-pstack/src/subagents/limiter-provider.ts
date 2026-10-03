import { availableParallelism } from 'node:os';

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { Check } from 'typebox/value';
import { type AcquireRequest, type AcquireResult, SubagentLimiter } from './limiter.ts';
import { defaultMaxConcurrency, defaultMaxDepth, type ReferenceSettings } from './settings.ts';
import type { SettingsStore } from './settings-store.ts';

export const linkChannel = 'reference-assistant:link';
export type LimiterLike = Readonly<{ tryAcquire: (request: AcquireRequest) => AcquireResult }>;
export type LinkAcquire = Readonly<{ kind: 'acquire'; request: AcquireRequest; reply: (result: AcquireResult) => void }>;

const RequestSchema = Type.Union([Type.Object({ kind: Type.Literal('spawn'), depth: Type.Integer({ minimum: 0 }) }), Type.Object({ kind: Type.Literal('resume') })]);
const LinkSchema = Type.Object({ kind: Type.Literal('acquire'), request: RequestSchema });

export function isLinkAcquire(payload: unknown): payload is LinkAcquire {
  return Check(LinkSchema, payload) && 'reply' in payload && typeof payload.reply === 'function';
}

export function limiterConfig(settings: ReferenceSettings, parallelism: number): { maxConcurrent: number; maxDepth: number } {
  return { maxConcurrent: settings.subagents.maxConcurrency ?? defaultMaxConcurrency(parallelism), maxDepth: settings.subagents.maxDepth ?? defaultMaxDepth };
}

/** A child session asks its parent for slots over the event bus the parent created for it, so every nested spawn counts against the root limiter. */
export function parentLimiter(events: ExtensionAPI['events']): LimiterLike {
  return {
    tryAcquire(request) {
      let answer: AcquireResult = { ok: false, limit: 'concurrent', message: 'The parent session is not accepting subagents.' };
      const payload: LinkAcquire = { kind: 'acquire', request, reply: (result) => (answer = result) };
      events.emit(linkChannel, payload);
      return answer;
    },
  };
}

/** One limiter per root session, configured once from the settings in force at the first use. A child never configures one. */
export class LimiterProvider {
  private root: SubagentLimiter | undefined;

  constructor(
    private readonly settings: SettingsStore,
    private readonly parent: () => LimiterLike | undefined,
    private readonly parallelism: () => number = availableParallelism,
  ) {}

  get(): LimiterLike {
    const inherited = this.parent();
    if (inherited) return inherited;
    this.root ??= new SubagentLimiter(limiterConfig(this.settings.read().settings, this.parallelism()));
    return this.root;
  }

  reset(): void {
    this.root = undefined;
  }
}
