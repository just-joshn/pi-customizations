import * as path from 'node:path';

import type { VM } from '@earendil-works/gondolin';
import type { FindOperations } from '@earendil-works/pi-coding-agent';
import { guestExists } from './fs-operations.ts';
import { toGuestPath, toPosix } from './paths.ts';

// The built-in find and grep skip these too, and walking them through the VM would be slow.
const SKIPPED_ENTRIES: ReadonlySet<string> = new Set(['.git', 'node_modules']);
export const ABORTED_MESSAGE = 'Operation aborted';
const POSIX_SEPARATOR = '/';

export type GuestFile = { guestPath: string; relativePath: string };

/** Gondolin reads a missing signal and an undefined one alike, and its option types accept only the first. */
export const signalOption = (signal: AbortSignal | undefined): { signal?: AbortSignal } => (signal ? { signal } : {});

export const throwIfAborted = (signal: AbortSignal | undefined): void => {
  if (signal?.aborted) throw new Error(ABORTED_MESSAGE);
};

async function* walkDirectory(vm: VM, dir: string, relativeDir: string, signal: AbortSignal | undefined): AsyncGenerator<GuestFile> {
  throwIfAborted(signal);
  const entries = await vm.fs.listDir(dir, signalOption(signal));
  for (const entry of entries.filter((name) => !SKIPPED_ENTRIES.has(name))) {
    const guestPath = path.posix.join(dir, entry);
    const relativePath = relativeDir ? path.posix.join(relativeDir, entry) : entry;
    // An entry that vanished or cannot be read is skipped, not fatal to the walk.
    const entryStat = await vm.fs.stat(guestPath, signalOption(signal)).catch(() => undefined);
    if (!entryStat) continue;
    if (entryStat.isDirectory()) yield* walkDirectory(vm, guestPath, relativePath, signal);
    else yield { guestPath, relativePath };
  }
}

/** Yields files under root lazily, so a caller that stops iterating also stops the walk and its VM round trips. */
export async function* walkGuestFiles(vm: VM, root: string, signal?: AbortSignal): AsyncGenerator<GuestFile> {
  throwIfAborted(signal);
  const stat = await vm.fs.stat(root, signalOption(signal));
  if (stat.isDirectory()) yield* walkDirectory(vm, root, '', signal);
  else yield { guestPath: root, relativePath: path.posix.basename(root) };
}

// Like the built-in find and grep: a pattern with '/' is relative to the search root, one without '/' matches file
// names at any depth.
export function matchesToolGlob(relativePath: string, pattern: string): boolean {
  const normalizedPattern = toPosix(pattern).replace(/^(?:\.\/)+/, '');
  if (normalizedPattern.includes(POSIX_SEPARATOR)) return path.posix.matchesGlob(relativePath, normalizedPattern);
  return path.posix.matchesGlob(path.posix.basename(relativePath), normalizedPattern);
}

async function firstMatches(files: AsyncIterable<GuestFile>, pattern: string, limit: number): Promise<string[]> {
  let results: readonly string[] = [];
  for await (const file of files) {
    if (results.length >= limit) break;
    if (matchesToolGlob(file.relativePath, pattern)) results = [...results, file.guestPath];
    if (results.length >= limit) break;
  }
  return [...results];
}

export function createGondolinFindOps(vm: VM, localCwd: string): FindOperations {
  return {
    exists: async (filePath) => guestExists(vm, localCwd, filePath),
    glob: async (pattern, cwd, options) => firstMatches(walkGuestFiles(vm, toGuestPath(localCwd, cwd)), pattern, options.limit),
  };
}
