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
  const parsed = z.coerce
    .number()
    .int()
    .min(min)
    .safeParse(value?.trim() ? value : undefined);
  return parsed.success ? parsed.data : fallback;
}

/** An unset or blank depth is the top level. A depth that is set but not a whole number fails closed, as if the limit were reached. */
function readDepth(value: string | undefined, maxDepth: number): number {
  return value?.trim() ? readInteger(value, 0, maxDepth) : DEFAULT_DEPTH;
}

export function readDepthPolicy(env: NodeJS.ProcessEnv): DepthPolicy {
  const maxDepth = readInteger(env[SUBAGENT_MAX_DEPTH_ENV], 0, DEFAULT_MAX_DEPTH);
  const depth = readDepth(env[SUBAGENT_DEPTH_ENV], maxDepth);
  const nextDepth = depth + 1;
  return { depth, maxDepth, nextDepth, canSpawn: depth < maxDepth, childCanSpawn: nextDepth < maxDepth };
}

export const readConcurrencyLimit = (env: NodeJS.ProcessEnv): number => readInteger(env[SUBAGENT_MAX_CONCURRENT_ENV], MIN_CONCURRENT, DEFAULT_MAX_CONCURRENT);

/** One running worker's place under the cap. */
export interface Slot {
  release: () => void;
}

export interface ConcurrencyGate {
  /** Takes one worker's slot, or returns undefined at the cap. */
  tryAcquire: () => Slot | undefined;
  /** How many more workers the cap lets start now. */
  available: () => number;
  limit: () => number;
}

export const concurrencyCapMessage = (limit: number): string => `Subagent concurrency cap reached (max ${limit} workers at once). Wait for running workers to finish, or raise ${SUBAGENT_MAX_CONCURRENT_ENV}.`;

/** Counts the workers running at once across every call of a session, foreground or woken. */
export function createConcurrencyGate(limit: () => number = () => DEFAULT_MAX_CONCURRENT): ConcurrencyGate {
  let activeCount = 0;
  const available = (): number => Math.max(0, limit() - activeCount);
  const makeSlot = (): Slot => {
    let released = false;
    return {
      release: () => {
        if (released) return;
        released = true;
        activeCount -= 1;
      },
    };
  };
  return {
    tryAcquire: () => {
      if (available() === 0) return undefined;
      activeCount += 1;
      return makeSlot();
    },
    available,
    limit,
  };
}
