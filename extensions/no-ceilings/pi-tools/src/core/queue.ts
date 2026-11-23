import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import { withFileMutationQueue } from '@earendil-works/pi-coding-agent';
import { canonicalPath, realpathOrSelf } from './paths.ts';

export interface QueueOptions {
  /** Create the parent directory before queueing. Defaults to true. */
  readonly createParent?: boolean;
}

/**
 * Serialize a mutation on one file, using a queue key that is stable before and after creation.
 * Pi keys its queue on `realpath(target)`, which changes once a file exists when the parent is reached
 * through a symlink (`/tmp` on macOS). Canonicalizing the parent first gives the same key for a new file
 * and an existing one, so two calls that create the same file cannot overlap.
 */
export async function withFileQueue<T>(target: string, fn: () => Promise<T>, options: QueueOptions = {}): Promise<T> {
  const key = await queueKey(target, options.createParent ?? true);
  return withFileMutationQueue(key, fn);
}

/**
 * Hold the queues for several paths at once, acquired in sorted order so two multi-file mutations
 * cannot deadlock. Use for a patch or a move that must see a consistent set of files.
 */
export async function withFileQueues<T>(targets: readonly string[], fn: () => Promise<T>, options: QueueOptions = {}): Promise<T> {
  const keys = [...new Set(await Promise.all(targets.map((target) => queueKey(target, options.createParent ?? true))))].sort();
  const acquire = async (index: number): Promise<T> => {
    const key = keys[index];
    if (key === undefined) {
      return fn();
    }
    return withFileMutationQueue(key, () => acquire(index + 1));
  };
  return acquire(0);
}

async function queueKey(target: string, createParent: boolean): Promise<string> {
  const parent = path.dirname(target);
  if (createParent) {
    await mkdir(parent, { recursive: true });
    return path.join(await realpathOrSelf(parent), path.basename(target));
  }
  return canonicalPath(target);
}
