import { z } from 'zod';

export const SUBAGENT_DEPTH_ENV = 'PI_SUBAGENT_DEPTH';
export const SUBAGENT_MAX_DEPTH_ENV = 'PI_SUBAGENT_MAX_DEPTH';
export const SUBAGENT_MAX_CONCURRENT_ENV = 'PI_SUBAGENT_MAX_CONCURRENT';

const DEFAULT_DEPTH = 0;
const DEFAULT_MAX_DEPTH = 3;
const DEFAULT_MAX_CONCURRENT = 20;
const MIN_CONCURRENT = 1;

export interface DepthPolicy {
  depth: number;
  maxDepth: number;
  nextDepth: number;
  canSpawn: boolean;
  childCanSpawn: boolean;
}

/** An environment variable read as a whole number of at least `min`; anything else reads as the fallback. */
function readInteger(value: string | undefined, min: number, fallback: number): number {
  const parsed = z.coerce.number().int().min(min).safeParse(value?.trim() ? value : undefined);
  return parsed.success ? parsed.data : fallback;
}

export function readDepthPolicy(env: NodeJS.ProcessEnv): DepthPolicy {
  const depth = readInteger(env[SUBAGENT_DEPTH_ENV], 0, DEFAULT_DEPTH);
  const maxDepth = readInteger(env[SUBAGENT_MAX_DEPTH_ENV], 0, DEFAULT_MAX_DEPTH);
  const nextDepth = depth + 1;
  return { depth, maxDepth, nextDepth, canSpawn: depth < maxDepth, childCanSpawn: nextDepth < maxDepth };
}

export const readConcurrencyLimit = (env: NodeJS.ProcessEnv): number => readInteger(env[SUBAGENT_MAX_CONCURRENT_ENV], MIN_CONCURRENT, DEFAULT_MAX_CONCURRENT);

export interface ConcurrencyGate {
  tryAcquire: (count: number) => { release: () => void } | undefined;
  active: () => number;
}

/** Counts the workers running at once across every call of a session, foreground or woken. */
export function createConcurrencyGate(limit: () => number = () => DEFAULT_MAX_CONCURRENT): ConcurrencyGate {
  let activeCount = 0;
  const makeReleaser = (count: number): (() => void) => {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      activeCount -= count;
    };
  };
  return {
    tryAcquire: (count) => {
      if (activeCount + count > limit()) return undefined;
      activeCount += count;
      return { release: makeReleaser(count) };
    },
    active: () => activeCount,
  };
}
