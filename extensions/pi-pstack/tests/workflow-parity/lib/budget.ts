// How long a real-model run may take. A fixed wall clock killed runs that were still working (feature, bug-fix, architect and swarm
// timed out in the middle of a phase at 900 s), so a run is stopped for one of two reasons: it made no progress for `idleMs`, or it
// reached an absolute `ceilingMs` that bounds a run that makes progress forever.
export interface Budget {
  /** Stop when nothing observable changed for this long. */
  idleMs: number;
  /** Stop at this age whatever the run is doing. */
  ceilingMs: number;
}

const MINUTE = 60_000;

/**
 * Real runs that finished on deepseek/deepseek-flash took 22 s to 554 s, and every family that fans out to several workers one after
 * another (the four that were killed at 900 s were all of that shape) is a multiple of that: three to five serial phases, each a
 * worker turn of several minutes. 60 min is that multiple with room, 30 min covers a single-agent or two-worker family.
 */
const FAN_OUT = new Set(['feature', 'bug-fix', 'perf-issue', 'refactoring', 'architect', 'swarm', 'arena', 'interrogate', 'hillclimb', 'feature-contested']);

/** A model turn, including a slow reasoning one, that writes nothing for this long is hung, not working. */
const IDLE_MS = 8 * MINUTE;

export function budgetFor(family: string): Budget {
  return { idleMs: IDLE_MS, ceilingMs: (FAN_OUT.has(family) ? 60 : 30) * MINUTE };
}

export type StopReason = 'idle' | 'ceiling';

/** Why a run must stop now, or null while it may go on. The ceiling wins when both hold. */
export function stopReason(budget: Budget, startedAt: number, lastProgressAt: number, now: number): StopReason | null {
  if (now - startedAt >= budget.ceilingMs) return 'ceiling';
  if (now - lastProgressAt >= budget.idleMs) return 'idle';
  return null;
}
