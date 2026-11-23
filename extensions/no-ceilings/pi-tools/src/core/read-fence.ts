import { MAX_FENCE_ENTRIES } from '../constants.ts';
import type { FileFingerprint, ReadRecord } from '../types.ts';

/**
 * Per-session record of what the agent has read or written, so a later mutation can refuse to clobber
 * a file that changed on disk in between. Entries are keyed by the string the caller supplies. Callers
 * pass one canonical file identity, so two spellings of one file share a record. Pi gives every tool call
 * its own id, so the session, not the tool call, is the meaningful scope. A record stays until the
 * session forgets it or the entry cap drops the oldest one.
 */
export interface ReadFence {
  record(target: string, record: ReadRecord): void;
  take(target: string): ReadRecord | undefined;
  /** Put a record back after a refused write, so a retry in the same session can still see it. */
  restore(target: string, record: ReadRecord): void;
  forget(target: string): void;
  size(): number;
}

export function createReadFence(): ReadFence {
  const entries = new Map<string, ReadRecord>();

  const cap = (): void => {
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
      entries.set(target, record);
      cap();
    },
    take(target) {
      const record = entries.get(target);
      if (record === undefined) {
        return undefined;
      }
      entries.delete(target);
      return record;
    },
    restore(target, record) {
      entries.set(target, record);
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
