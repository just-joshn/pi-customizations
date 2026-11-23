import { FENCE_TTL_MS, MAX_FENCE_ENTRIES } from '../constants.ts';
import type { FileFingerprint, ReadRecord } from '../types.ts';

interface Entry {
  readonly record: ReadRecord;
  readonly expiresAt: number;
}

/**
 * Per-session record of what the agent has read or written, so a later mutation can refuse to clobber
 * a file that changed on disk in between. Entries are keyed by the string the caller supplies. Callers
 * pass one canonical file identity, so two spellings of one file share a record. Pi gives every tool call
 * its own id, so the session, not the tool call, is the meaningful scope.
 */
export interface ReadFence {
  record(target: string, record: ReadRecord): void;
  take(target: string): ReadRecord | undefined;
  /** Put a record back after a refused write, so a retry in the same session can still see it. */
  restore(target: string, record: ReadRecord): void;
  forget(target: string): void;
  size(): number;
}

export function createReadFence(now: () => number = Date.now): ReadFence {
  const entries = new Map<string, Entry>();

  const prune = (): void => {
    const cutoff = now();
    for (const [key, entry] of entries) {
      if (entry.expiresAt <= cutoff) {
        entries.delete(key);
      }
    }
    while (entries.size > MAX_FENCE_ENTRIES) {
      const oldest = entries.keys().next();
      if (oldest.done === true) {
        break;
      }
      entries.delete(oldest.value);
    }
  };

  return {
    record(target, record) {
      entries.set(target, { record, expiresAt: now() + FENCE_TTL_MS });
      prune();
    },
    take(target) {
      const entry = entries.get(target);
      if (!entry) {
        return undefined;
      }
      entries.delete(target);
      return entry.expiresAt <= now() ? undefined : entry.record;
    },
    restore(target, record) {
      entries.set(target, { record, expiresAt: now() + FENCE_TTL_MS });
    },
    forget(target) {
      entries.delete(target);
    },
    size() {
      return entries.size;
    },
  };
}

export type { FileFingerprint };
